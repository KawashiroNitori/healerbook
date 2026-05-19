-- 协作编辑:编辑者白名单 + 申请开关 + 编辑权限申请

-- 编辑者白名单:(timeline_id, user_id) 决定谁能经 WebSocket 编辑某条时间轴。
-- 本期手工填充 + 发布时自动插入作者(见路由 POST /api/timelines)。
-- user_name 用于作者面板展示编辑者;不带 user_name 的插入取默认空串。
CREATE TABLE IF NOT EXISTS timeline_editors (
  timeline_id TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  user_name   TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (timeline_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_editors_user ON timeline_editors (user_id);

-- 申请开关:每条时间轴是否允许他人申请编辑权限
ALTER TABLE timelines ADD COLUMN allow_edit_requests INTEGER NOT NULL DEFAULT 0;

-- 待处理的编辑权限申请。只存 pending 状态:通过/拒绝即删行。
CREATE TABLE IF NOT EXISTS timeline_edit_requests (
  timeline_id TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  user_name   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (timeline_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_edit_requests_timeline
  ON timeline_edit_requests (timeline_id);
