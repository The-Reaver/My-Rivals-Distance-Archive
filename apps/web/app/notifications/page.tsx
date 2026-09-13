import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The reader-facing half of the Request Fulfillment Loop (game plan Idea
// 2): "every reader holding a request for that character gets one quiet
// Activity Feed item." No broader activity-feed framework exists yet --
// notifications (0008) currently has exactly one writer
// (notify_chronicle_request_fulfillment()), so this page is that writer's
// only reader today, not a general-purpose feed. RLS's
// notifications_select_own already scopes the query to this reader's own
// rows; no filtering happens in application code.
//
// Deliberately no mark-as-read interaction in this pass -- read_at exists
// on the table for a future pass, nothing writes it yet.
//
// Real email delivery (the other half of Idea 2) needs an email-provider
// account/API key decision outside this session's authority; see CLAUDE.md.
export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signup");
  }

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, kind, message, character_id, characters(slug), created_at, read_at")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-reader">
        <h1 className="font-display text-section-heading text-text-primary">Notifications</h1>

        {error && (
          <p className="mt-lg font-body text-body text-accent-ember">
            Could not load notifications: {error.message}
          </p>
        )}

        {!error && (!notifications || notifications.length === 0) && (
          <p className="mt-lg font-body text-body-small text-accent-steel">
            Nothing yet. Requested Chronicles show up here the moment they go live.
          </p>
        )}

        {notifications && notifications.length > 0 && (
          <ul className="mt-lg space-y-md">
            {notifications.map((notification) => {
              const character = Array.isArray(notification.characters)
                ? notification.characters[0]
                : notification.characters;
              const body = (
                <>
                  <p className="font-body text-body text-text-primary">{notification.message}</p>
                  <p className="mt-xs font-mono text-caption text-accent-steel">
                    {new Date(notification.created_at).toLocaleString()}
                  </p>
                </>
              );

              return (
                <li
                  key={notification.id}
                  className="rounded-card border border-border-subtle bg-bg-elevated p-md"
                >
                  {character ? (
                    <Link href={`/characters/${character.slug}`} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
