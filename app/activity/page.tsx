import EmptyView from "@/components/EmptyView";
export default function ActivityPage() {
  return <EmptyView eyebrow="ON-CHAIN ACTIVITY" title="Only real transactions."
    description="Watch verified mints, purchases, sales and transfers when enabled."
    nextMilestone="A transaction is displayed only after indexed chain evidence. The activity feed is intentionally empty in M1." />;
}
