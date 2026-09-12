import Link from "next/link";

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="font-display text-section-heading text-text-primary">Admin</h1>
      <p className="mt-xs font-body text-body-small text-accent-steel">
        Signed in. Tooling lands here incrementally.
      </p>
      <ul className="mt-lg space-y-sm">
        <li>
          <Link
            href="/admin/chronicles"
            className="font-body text-body text-accent-gold underline underline-offset-2"
          >
            Chronicle entries
          </Link>
        </li>
      </ul>
    </div>
  );
}
