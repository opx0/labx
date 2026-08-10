import styles from "./GroundRules.module.css";

const RULES = [
  {
    num: "01",
    title: "The agent proposes; it cannot write.",
    body: "It reads DataHub through the official MCP server with every write tool disabled. The only mutation path in the system is the Gateway.",
  },
  {
    num: "02",
    title: "A human authorizes a specific reality.",
    body: "Approval is bound to this action, this target, these parameters, and a fingerprint of the exact data observed — not standing permission.",
  },
  {
    num: "03",
    title: "Reality is re-checked before acting.",
    body: "The Gateway re-reads DataHub and recomputes the fingerprint at execution time. If the world moved, the authority is permanently invalidated.",
  },
  {
    num: "04",
    title: "Everything is on the record.",
    body: "Action, passport, policy decision, approval, authorization, execution and receipt are one Postgres chain — including the changes that were refused.",
  },
];

export function GroundRules() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>The rules of the system</h2>
      <p className={styles.intro}>
        Four constraints hold everything that follows. Grasp these and the demo explains itself.
      </p>
      <div className={styles.grid}>
        {RULES.map((rule) => (
          <article key={rule.num} className={`panel ${styles.card}`}>
            <span className={styles.num}>{rule.num}</span>
            <h3 className={styles.title}>{rule.title}</h3>
            <p className={styles.body}>{rule.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
