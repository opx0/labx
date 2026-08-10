import { TopBar } from "./topbar";

export default function NotFound() {
  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="panel nf-panel">
          <div className="nf-code">404</div>
          <p className="nf-line">
            This page does not exist — the Gateway would have refused it too.
          </p>
          <p className="nf-links">
            <a href="/">Console</a>
            <a href="/architecture">Architecture</a>
          </p>
        </div>
      </div>
    </>
  );
}
