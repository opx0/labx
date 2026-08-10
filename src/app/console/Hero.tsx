import styles from "./Hero.module.css";

export function Hero() {
  return (
    <header className={styles.hero}>
      <p className={styles.eyebrow}>Context-bound authorization · live against a real DataHub</p>
      <h1 className={styles.title}>Stale authority dies here.</h1>
      <p className={styles.lead}>
        Every approval workflow has the same blind spot: the gap between a human&apos;s yes and the
        agent&apos;s action. DataHubX binds the approval to a cryptographic fingerprint of the exact
        world the human saw, and an execution Gateway re-reads DataHub immediately before any
        mutation. Same world — execute once, verify by reading it back. Changed world — the approval
        is permanently dead and nothing is touched.
      </p>
      <ul className={styles.claims}>
        <li>15 checks before any write</li>
        <li>0 write tools on the agent</li>
        <li>Every refusal recorded</li>
      </ul>
      <div className={styles.actions}>
        <a
          className="btn primary"
          href="https://catalog.opxz.dev/demo-login"
          target="_blank"
          rel="noreferrer"
        >
          Open the live catalog
        </a>
        <a className="btn ghost" href="/architecture">
          See the architecture
        </a>
      </div>
    </header>
  );
}
