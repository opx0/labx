import { TopBar } from "../topbar";

export default function Loading() {
  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="cl-feed">
          {[1, 2, 3].map((i) => (
            <div key={i} className="cl-card">
              <div className="skel" style={{ width: "42%" }} />
              <div className="skel" style={{ width: "68%" }} />
              <div className="skel" style={{ width: "55%" }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
