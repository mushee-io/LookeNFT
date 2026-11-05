import Link from "next/link";

export default function EmptyView({ eyebrow, title, description, nextMilestone }: {
  eyebrow: string; title: string; description: string; nextMilestone: string;
}) {
  return (
    <section className="interior">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="interior-copy">{description}</p>
      <div className="empty-state interior-empty">
        <div className="empty-icon">◇</div>
        <h2>Foundation available · Feature not activated</h2>
        <p>{nextMilestone}</p>
        <Link className="secondary-link" href="/">Back to home</Link>
      </div>
    </section>
  );
}
