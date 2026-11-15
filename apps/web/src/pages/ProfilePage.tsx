import { useEffect, useState } from "react";
import { BadgeCheck, History, LogIn, LogOut, Save } from "lucide-react";
import type { AvatarId, ProfileResponse } from "@imposter/shared";
import { Avatar, AvatarPicker } from "../components/Avatar.js";
import { StatsPanel } from "../components/StatsPanel.js";
import { Button, Panel } from "../components/ui.js";
import { api, ApiError } from "../state/api.js";
import { hrefFor, navigate } from "../state/router.js";
import { clearSession, updateSessionAccount, useSession } from "../state/session.js";
import { reconnectSocket } from "../state/socket.js";

function joinedLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function useProfile(username: string | null) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!username) return;
    let active = true;
    setLoading(true);
    setError("");
    setProfile(null);
    api
      .profile(username)
      .then((next) => active && setProfile(next))
      .catch((caught) => active && setError(caught instanceof ApiError ? caught.message : "Could not load this profile."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [username]);
  return { profile, error, loading };
}

/** Your own profile: avatar, account details and sign-out. */
export function ProfilePage() {
  const session = useSession();
  const { profile, error } = useProfile(session?.account.username ?? null);
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <section className="auth-page">
        <Panel className="auth-card">
          <h1>Your profile</h1>
          <p className="muted">Sign in to see your profile. Guests can still play every game.</p>
          <a className="btn" href={hrefFor({ name: "login" })}><LogIn size={18} />Sign in</a>
        </Panel>
      </section>
    );
  }

  const chosen = avatar ?? session.account.avatar;
  const saveAvatar = async () => {
    setBusy(true);
    setStatus("");
    try {
      updateSessionAccount(await api.updateAvatar(chosen));
      setAvatar(null);
      // The game server reads your avatar when the connection is made; refresh it.
      reconnectSocket();
      setStatus("Avatar saved.");
    } catch (caught) {
      setStatus(caught instanceof ApiError ? caught.message : "Could not save your avatar.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    // Revoke the token on the server; sign out locally even if the server is unreachable.
    await api.logout().catch(() => undefined);
    clearSession();
    reconnectSocket();
    navigate({ name: "home" });
  };

  return (
    <section className="profile-page">
      <Panel className="profile-header">
        <Avatar avatar={chosen} size="lg" />
        <div>
          <p className="eyebrow">Your profile</p>
          <h1>
            {session.account.username}
            <BadgeCheck size={22} className="verified" aria-label="Signed-in account" />
          </h1>
          <p className="muted">Joined {joinedLabel(session.account.joinedAt)}</p>
        </div>
        <Button className="btn-secondary" onClick={signOut} disabled={busy}><LogOut size={18} />Sign out</Button>
      </Panel>

      <Panel>
        <h2>Avatar</h2>
        <AvatarPicker value={chosen} onChange={setAvatar} disabled={busy} />
        <div className="button-row">
          <Button onClick={saveAvatar} disabled={busy || chosen === session.account.avatar}><Save size={18} />Save avatar</Button>
          {status && <span className="muted" role="status">{status}</span>}
        </div>
      </Panel>

      <ProfileDetails profile={profile} error={error} title="Your statistics" />
      <Panel className="history-teaser">
        <div>
          <h2>Match history</h2>
          <p className="muted">Every completed game you played while signed in, with final standings.</p>
        </div>
        <a className="btn btn-secondary" href={hrefFor({ name: "history" })}><History size={18} />View match history</a>
      </Panel>
    </section>
  );
}

/** Someone's public profile. */
export function PlayerPage({ username }: { username: string }) {
  const { profile, error, loading } = useProfile(username);
  return (
    <section className="profile-page">
      <Panel className="profile-header">
        <Avatar avatar={profile?.profile.avatar ?? null} initials={username.slice(0, 2).toUpperCase()} size="lg" />
        <div>
          <p className="eyebrow">Player</p>
          <h1>
            {profile?.profile.username ?? username}
            {profile && <BadgeCheck size={22} className="verified" aria-label="Signed-in account" />}
          </h1>
          {profile && <p className="muted">Joined {joinedLabel(profile.profile.joinedAt)}</p>}
          {loading && <p className="muted">Loading...</p>}
        </div>
      </Panel>
      <ProfileDetails profile={profile} error={error} title="Statistics" />
    </section>
  );
}

function ProfileDetails({ profile, error, title }: { profile: ProfileResponse | null; error: string; title: string }) {
  if (error) return <Panel><p className="form-error" role="alert">{error}</p></Panel>;
  if (!profile) return <Panel><p className="muted" role="status">Loading statistics...</p></Panel>;
  return <StatsPanel stats={profile.stats} title={title} />;
}
