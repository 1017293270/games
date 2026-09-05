/**
 * Placeholder for the operator console. The real panel lands with the admin
 * milestone; this route exists now so it can be linked and lazily loaded.
 */
export default function AdminPage() {
  return (
    <div className="empty" style={{ flex: 1, justifyContent: 'center' }}>
      <h1 className="ink-display" style={{ fontSize: 'var(--fs-display)' }}>
        后台建设中
      </h1>
      <p>世界设置、机器人与玩家管理将在后续版本开放。</p>
      <a href="/">返回修炼场</a>
    </div>
  );
}
