#!/usr/bin/env bash
# L11 实验:真 PostgreSQL 看索引前后的执行计划
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

command -v docker >/dev/null 2>&1 || { echo "!! 没有 docker,看预期输出即可"; exit 0; }

if ! docker ps --format '{{.Names}}' | grep -q '^study-pg$'; then
    docker start study-pg >/dev/null 2>&1 || {
        echo "!! study-pg 起不来。手动:"
        echo "   docker run -d --name study-pg -p 127.0.0.1:15433:5432 \\"
        echo "     -e POSTGRES_PASSWORD=study -e POSTGRES_USER=study -e POSTGRES_DB=study \\"
        echo "     docker.m.daocloud.io/library/postgres:16"
        exit 0
    }
    sleep 3
fi

PSQL() { docker exec study-pg psql -U study -d study -tA "$@" 2>&1; }
PSQLp() { docker exec study-pg psql -U study -d study "$@" 2>&1; }

echo "  study-pg: $(PSQL -c 'select version();' | head -1 | cut -c1-40)"

step "准备一张 10 万行的表(无索引)"
PSQL -c "drop table if exists demo;" >/dev/null
PSQL -c "create table demo(id serial primary key, uid int, amount int, name text, created timestamptz default now());" >/dev/null
PSQL -c "insert into demo(uid,amount,name)
         select (random()*10000)::int, (random()*1000)::int,
                '用户'||(random()*10000)::int
         from generate_series(1,100000);" >/dev/null
echo "  已插入 $(PSQL -c 'select count(*) from demo;') 行"

hr
echo "=== 建索引【前】:查 uid=555 ==="
hr
PSQLp -c "explain analyze select * from demo where uid=555;" \
  | grep -E 'Seq Scan|Index|Execution|Planning' | sed 's/^/  /'
echo "  ↑ Seq Scan = 全表扫描,10 万行逐行读一遍"

step "建索引: create index idx_uid on demo(uid)"
PSQL -c "create index idx_uid on demo(uid);" >/dev/null
# VACUUM ANALYZE:更新统计信息 + 建 visibility map(Index Only Scan 需要它)
PSQL -c "vacuum analyze demo;" >/dev/null

echo
hr
echo "=== 建索引【后】:同样查 uid=555 ==="
hr
PSQLp -c "explain analyze select * from demo where uid=555;" \
  | grep -E 'Seq Scan|Index|Execution|Planning' | sed 's/^/  /'
echo "  ↑ 变成 Index Scan,直接定位,不再扫全表"

echo
hr
echo "=== 索引失效的几种写法(都会退回 Seq Scan)==="
hr
check_plan() {
    local desc="$1" sql="$2"
    local plan
    plan=$(PSQLp -c "explain $sql" | grep -oE 'Seq Scan|Index Scan|Bitmap.*Scan' | head -1)
    printf "  %-34s -> %s\n" "$desc" "${plan:-?}"
}
check_plan "where uid = 555          (正常)"      "select * from demo where uid=555;"
check_plan "where uid + 1 = 556      (列上运算)"  "select * from demo where uid+1=556;"
check_plan "where uid::text = '555'  (类型转换)"  "select * from demo where uid::text='555';"
# text_pattern_ops:让 like 'x%' 能用索引(默认排序规则下 like 不一定能用)
PSQL -c "create index idx_name on demo(name text_pattern_ops);" >/dev/null
PSQL -c "vacuum analyze demo;" >/dev/null
check_plan "where name like '%用户5' (左模糊)"    "select id from demo where name like '%用户5';"
echo "       ^ 左模糊永远用不了索引:不知道开头,索引这本'字典'帮不上忙"
echo
echo "  (右模糊 like 'x%' 能用索引,但若匹配行数太多,优化器会主动选全表扫描 ——"
echo "   那是成本权衡,不是索引失效。数据分布也会影响计划。)"

echo
hr
echo "=== 覆盖索引:避免回表 ==="
hr
PSQL -c "create index idx_uid_amount on demo(uid, amount);" >/dev/null
PSQL -c "vacuum analyze demo;" >/dev/null
echo "  建了联合索引 (uid, amount)"
echo
echo "  A) select amount from demo where uid=555  (要的列 amount 就在索引里):"
PSQLp -c "explain select amount from demo where uid=555;" \
  | grep -iE 'Index Only Scan|Index Scan|Bitmap' | head -1 | sed 's/^/       /'
echo "     ↑ Index Only Scan = 覆盖索引,数据直接从索引拿,【连回表都省了】"
echo
echo "  B) select name from demo where uid=555  (name 不在索引里):"
PSQLp -c "explain select name from demo where uid=555;" \
  | grep -iE 'Index Only Scan|Index Scan|Bitmap' | head -1 | sed 's/^/       /'
echo "     ↑ 不是 Index Only —— 拿到主键后还要【回表】去取 name 这一列"

echo
hr
cat <<'SUMMARY'
结论:

  1. Seq Scan(全表扫描)+ 大表 + 慢 = 缺索引。加索引常能快几十倍。

  2. 索引会失效,写完 SQL 必须 EXPLAIN 确认:
       列上做运算、类型转换、左模糊 like '%x' —— 都会退回全表扫描

  3. 覆盖索引(要的列都在索引里)能省掉回表,是 SQL 优化最常见的收益点

  4. 索引不是免费的:占空间、拖慢写入。只给真正用于查询的列建,别乱建。
SUMMARY

# 收拾
PSQL -c "drop table if exists demo;" >/dev/null 2>&1
