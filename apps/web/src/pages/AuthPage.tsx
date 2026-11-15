import { useState, type FormEvent } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { DEFAULT_AVATAR, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, passwordSchema, usernameSchema, type AvatarId } from "@imposter/shared";
import { AvatarPicker } from "../components/Avatar.js";
import { Button, Input, Panel } from "../components/ui.js";
import { api, ApiError } from "../state/api.js";
import { hrefFor, navigate } from "../state/router.js";
import { setSession } from "../state/session.js";
import { reconnectSocket } from "../state/socket.js";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>(DEFAULT_AVATAR);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (registering) {
      const nameCheck = usernameSchema.safeParse(username);
      if (!nameCheck.success) return setError(nameCheck.error.issues[0]?.message ?? "Choose another username.");
      const passwordCheck = passwordSchema.safeParse(password);
      if (!passwordCheck.success) return setError(passwordCheck.error.issues[0]?.message ?? "Choose another password.");
      if (password !== confirm) return setError("The passwords do not match.");
    } else if (!username.trim() || !password) {
      return setError("Enter your username and password.");
    }

    setBusy(true);
    try {
      const session = registering ? await api.register(username.trim(), password, avatar) : await api.login(username.trim(), password);
      setSession(session);
      // Reconnect so the game server sees the new identity before the next room is created.
      reconnectSocket();
      navigate({ name: "home" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-page">
      <Panel className="auth-card">
        <p className="eyebrow">{registering ? "New player" : "Welcome back"}</p>
        <h1>{registering ? "Create your account" : "Sign in"}</h1>
        <p className="muted">
          {registering
            ? "No email needed. Your username is public and shown with a verified badge in rooms."
            : "You stay signed in for this browser tab for up to 12 hours."}
        </p>
        <form className="auth-form" onSubmit={submit} noValidate>
          <Input
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            maxLength={registering ? USERNAME_MAX_LENGTH : 64}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={registering ? `${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} letters, numbers or _` : "Your username"}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            value={password}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={registering ? `At least ${PASSWORD_MIN_LENGTH} characters` : ""}
          />
          {registering && (
            <>
              <Input label="Confirm password" name="confirm" type="password" autoComplete="new-password" value={confirm} maxLength={128} onChange={(event) => setConfirm(event.target.value)} />
              <div className="field">
                <span>Avatar</span>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </div>
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {registering ? <UserPlus size={18} /> : <LogIn size={18} />}
            {busy ? "Please wait..." : registering ? "Create account" : "Sign in"}
          </Button>
        </form>
        <p className="muted auth-switch">
          {registering ? "Already have an account? " : "New here? "}
          <a href={hrefFor({ name: registering ? "login" : "register" })}>{registering ? "Sign in" : "Create an account"}</a>
          {" · "}
          <a href={hrefFor({ name: "home" })}>Play as a guest</a>
        </p>
      </Panel>
    </section>
  );
}
