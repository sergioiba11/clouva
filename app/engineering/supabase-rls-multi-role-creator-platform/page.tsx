import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Designing Supabase RLS for a Multi-Role Creator Platform | CLOUVA Engineering",
  description:
    "How CLOUVA separates global identity, public membership, private permissions and privileged administration with Supabase RLS and server-side authorization.",
  alternates: {
    canonical: "/engineering/supabase-rls-multi-role-creator-platform",
  },
  openGraph: {
    title: "Designing Supabase RLS for a Multi-Role Creator Platform",
    description:
      "A production case study from CLOUVA: identity boundaries, RLS, role projection, server-side authorization and security contract tests.",
    type: "article",
    url: "/engineering/supabase-rls-multi-role-creator-platform",
  },
};

const profilePolicy = `-- Simplified version of the boundary used in CLOUVA
create policy "profiles_self_select"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_self_update"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);`;

const columnGrant = `-- Privileged account state is intentionally not client-writable
grant update (
  display_name,
  full_name,
  avatar_url,
  bio,
  username,
  city,
  country_code,
  social_links,
  spotify_url,
  onboarding_status
) on public.profiles to authenticated;

-- role, role_v2, is_vip and is_blocked are omitted.`;

const membershipModel = `studio_memberships
  -> commercial/public membership state
  -> status, plan, source membership

studio_members
  -> private operational permission
  -> who may manage the Studio

player_studios
  -> public projection
  -> visible role inside that Studio`;

const adminGate = `// Conceptual server-side flow
const user = await supabase.auth.getUser(accessToken);
if (!user.data.user) throw new Error("Unauthorized");

const admin = createAdminSupabase();
const profile = await admin
  .from("profiles")
  .select("role, role_v2, is_blocked")
  .eq("id", user.data.user.id)
  .single();

if (profile.data?.is_blocked) throw new Error("Account blocked");
if (profile.data?.role !== "admin" && profile.data?.role_v2 !== "admin") {
  throw new Error("Admin required");
}`;

const contractTest = `for (const column of ["role", "role_v2", "is_vip", "is_blocked"]) {
  test(\`authenticated profile writes never grant \${column}\`, () => {
    assert.doesNotMatch(updateGrant, new RegExp(\`\\\\b\${column}\\\\b\`, "i"));
  });
}`;

const lessons = [
  {
    title: "Identity is not authorization",
    body:
      "A public creator identity can say that someone is a founder, artist or manager. That label should never be the thing that grants database authority. CLOUVA keeps public identity and operational permission as separate concepts.",
  },
  {
    title: "RLS should protect boring failure modes",
    body:
      "The dangerous bugs are usually not exotic. They are an authenticated browser accidentally being allowed to update a privileged column, a public policy exposing private profile rows, or an admin UI mutating the database directly.",
  },
  {
    title: "Project roles belong to the project",
    body:
      "A person can be a founder in one Studio and a regular member in another. Encoding that into one global user role makes the schema lie. Scoped roles are modeled on the relationship, not on the person.",
  },
  {
    title: "Server checks are not a replacement for RLS",
    body:
      "I use server-side authorization for privileged operations and RLS as the database boundary. Either layer can catch a mistake in the other. The two controls solve different failure modes.",
  },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/70 p-5 text-[13px] leading-6 text-zinc-200 shadow-2xl">
      <code>{children}</code>
    </pre>
  );
}

export default function SupabaseRlsCreatorPlatformArticle() {
  const published = "September 24, 2026";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Designing Supabase RLS for a Multi-Role Creator Platform",
    description:
      "A production case study from CLOUVA about identity boundaries, Supabase RLS, membership projections and server-side authorization.",
    datePublished: "2026-09-24",
    dateModified: "2026-09-24",
    author: {
      "@type": "Person",
      name: "Sergio Ibañez",
      url: "https://clouva.com.ar/clouva",
    },
    publisher: {
      "@type": "Organization",
      name: "CLOUVA",
      url: "https://clouva.com.ar",
    },
    mainEntityOfPage:
      "https://clouva.com.ar/engineering/supabase-rls-multi-role-creator-platform",
  };

  return (
    <main className="min-h-screen bg-[#08080a] text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <nav className="mb-12 flex items-center justify-between gap-4 text-sm text-zinc-400">
          <Link href="/" className="font-semibold tracking-[0.2em] text-white">
            CLOUVA
          </Link>
          <span>ENGINEERING NOTE</span>
        </nav>

        <header className="mb-14">
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-violet-300">
            Supabase · PostgreSQL · Next.js · Security
          </p>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
            Designing Supabase RLS for a multi-role creator platform
          </h1>
          <p className="mt-7 text-xl leading-8 text-zinc-300">
            The hardest authorization problem in CLOUVA was not “how do I add roles?”
            It was deciding which roles belong to a person, which belong to a Studio,
            which data is public, and which operations should never be trusted to a browser.
          </p>
          <div className="mt-7 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-500">
            <span>By Sergio Ibañez</span>
            <span>•</span>
            <time dateTime="2026-09-24">{published}</time>
            <span>•</span>
            <span>Production case study</span>
          </div>
        </header>

        <div className="space-y-12 text-[17px] leading-8 text-zinc-300">
          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">The context</h2>
            <p>
              CLOUVA is a creator platform I am building with Next.js, React, TypeScript,
              Supabase/PostgreSQL and Google Cloud. A user can have a personal profile,
              publish a Player identity, join Studios, operate a Studio, buy products,
              manage projects and access privileged tools.
            </p>
            <p className="mt-5">
              That creates an authorization trap: a single global <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm">role</code> column
              quickly becomes overloaded. Someone may be a founder in one Studio, a member
              in another and an ordinary customer everywhere else. A role that is correct
              in one context becomes dangerously broad in another.
            </p>
            <p className="mt-5">
              My rule became: <strong className="text-white">global identity describes the account;
              relationship rows describe authority inside a resource.</strong>
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">1. Make the private profile actually private</h2>
            <p>
              Early creator products often use one profile table for everything: authentication,
              public bio, social identity and internal account flags. That is convenient until a
              “public profiles” policy exposes fields that were never meant to be public.
            </p>
            <p className="mt-5">
              CLOUVA moved toward a stricter boundary. The authenticated profile row is self-readable,
              anonymous access is revoked, and public creator identity is served through separate
              public-facing entities. The important point is not the exact table names; it is that
              public discovery should not require weakening the privacy of the account table.
            </p>
            <div className="mt-6">
              <CodeBlock>{profilePolicy}</CodeBlock>
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">2. RLS is necessary, but column privileges matter too</h2>
            <p>
              A row policy can correctly say “users may update their own profile” and still leave
              a privilege escalation if the client can update columns such as <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm">role</code>,
              <code className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-sm">is_vip</code> or
              <code className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-sm">is_blocked</code>.
            </p>
            <p className="mt-5">
              I treat the allowed write surface as part of the authorization design. Normal users
              can update personal presentation fields, while privileged account state is omitted
              from authenticated column grants and receives safe database defaults.
            </p>
            <div className="mt-6">
              <CodeBlock>{columnGrant}</CodeBlock>
            </div>
            <p className="mt-5">
              This is a useful defense against a common frontend mistake: a generic “save profile”
              payload accidentally including fields copied from an admin response.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">3. Separate membership from permission</h2>
            <p>
              A membership is not always an authorization record. In CLOUVA I needed to represent
              commercial membership state, public Studio affiliation and actual operational access.
              Collapsing all three into one table would make cancellation, visibility and permission
              changes tightly coupled.
            </p>
            <div className="mt-6">
              <CodeBlock>{membershipModel}</CodeBlock>
            </div>
            <p className="mt-5">
              The public projection can say “this Player belongs to this Studio” without granting
              management rights. A Studio-specific role can also be projected to the public roster
              without mutating the Player’s global identity.
            </p>
            <p className="mt-5">
              Activation is handled as a database operation that creates or updates the relevant
              membership and projection rows together. When a membership is cancelled or expires,
              the public projection is made inactive. This avoids the classic state where billing
              says one thing and the public roster says another.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">4. Privileged writes go through a server choke point</h2>
            <p>
              I do not let the admin dashboard perform privileged table updates directly from the
              browser. The client calls an authenticated API route. The server validates the access
              token with Supabase Auth, reads account state with a server-side client and only then
              performs the privileged mutation.
            </p>
            <div className="mt-6">
              <CodeBlock>{adminGate}</CodeBlock>
            </div>
            <p className="mt-5">
              The service-role client is powerful, so the order matters: validate the user first,
              check account state and authorization second, and instantiate privileged behavior only
              inside that trusted server flow. A service-role key should never become an escape hatch
              for missing authorization logic.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">5. Test the security invariants, not only the UI</h2>
            <p>
              I added repository-level contract tests for security-sensitive decisions. They are not
              a replacement for database integration tests, but they catch accidental regressions
              during refactors: reintroducing a public profile policy, granting privileged columns,
              or moving an admin mutation back into the browser.
            </p>
            <div className="mt-6">
              <CodeBlock>{contractTest}</CodeBlock>
            </div>
            <p className="mt-5">
              This kind of test is intentionally boring. Security boundaries should be boring.
              If a future refactor makes <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm">role</code> client-writable again,
              I want the repository to complain immediately.
            </p>
          </section>

          <section>
            <h2 className="mb-6 text-2xl font-semibold text-white">What this architecture taught me</h2>
            <div className="grid gap-4">
              {lessons.map((lesson) => (
                <div key={lesson.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
                  <h3 className="text-lg font-semibold text-white">{lesson.title}</h3>
                  <p className="mt-2 text-zinc-400">{lesson.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold text-white">What I would improve next</h2>
            <p>
              The next step is to complement source-level security contracts with an ephemeral
              database test matrix: anonymous vs authenticated vs admin, every sensitive table,
              and explicit positive and negative cases for select/insert/update/delete. I also want
              policy performance checks around the highest-volume relationship tables so security
              remains cheap as the graph grows.
            </p>
            <p className="mt-5">
              The broader lesson is that RLS works best when the data model already expresses the
              truth. If the schema cannot distinguish public identity, membership and authority,
              no amount of policy syntax will make the model easy to reason about.
            </p>
          </section>

          <section className="rounded-3xl border border-violet-400/20 bg-violet-400/[0.06] p-7">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-violet-300">About the project</p>
            <p className="mt-3">
              CLOUVA is the production environment where I build and test creator, commerce,
              studio and AI workflows. The repository is public, so the implementation and tests
              behind this article can be inspected directly.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="https://github.com/sergioiba11/clouva"
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                View the repository
              </a>
              <Link
                href="/clouva"
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
              >
                About CLOUVA
              </Link>
            </div>
          </section>
        </div>
      </article>
    </main>
  );
}
