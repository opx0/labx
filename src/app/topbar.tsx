// One centered translucent pill: brand, navigation, and the catalog link —
// no side blocks. Shared by the console and the architecture page.
export function TopBar() {
  return (
    <nav className="topbar">
      <div className="nav-pills">
        <a className="brand" href="/#top">
          <span className="brand-dot" />
          DataHubX
        </a>
        <a href="/#console">Console</a>
        <a href="/architecture">Architecture</a>
        <a href="/changelog">Changelog</a>
        <a href="https://github.com/opx0/labx" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a
          className="pill-cta"
          href="https://catalog.opxz.dev/demo-login"
          target="_blank"
          rel="noreferrer"
        >
          Open catalog
        </a>
      </div>
    </nav>
  );
}
