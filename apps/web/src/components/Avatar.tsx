import { Bird, Bot, Cat, Crown, Fish, Flame, Gamepad2, Ghost, Moon, Rocket, Star, Zap, type LucideIcon } from "lucide-react";
import { AVATAR_IDS, type AvatarId } from "@imposter/shared";

const ICONS: Record<AvatarId, LucideIcon> = {
  rocket: Rocket,
  ghost: Ghost,
  cat: Cat,
  crown: Crown,
  flame: Flame,
  gamepad: Gamepad2,
  bird: Bird,
  fish: Fish,
  star: Star,
  zap: Zap,
  moon: Moon,
  bot: Bot
};

const LABELS: Record<AvatarId, string> = {
  rocket: "Rocket",
  ghost: "Ghost",
  cat: "Cat",
  crown: "Crown",
  flame: "Flame",
  gamepad: "Gamepad",
  bird: "Bird",
  fish: "Fish",
  star: "Star",
  zap: "Lightning",
  moon: "Moon",
  bot: "Robot"
};

/** A preset avatar icon, or the player's initials for guests. */
export function Avatar({ avatar, initials, size = "md" }: { avatar: AvatarId | null | undefined; initials?: string; size?: "sm" | "md" | "lg" }) {
  if (!avatar) return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials ?? "?"}</span>;
  const Icon = ICONS[avatar];
  return (
    <span className={`avatar avatar-${size} avatar-icon avatar-${avatar}`} aria-hidden="true">
      <Icon size={size === "lg" ? 34 : size === "sm" ? 15 : 18} />
    </span>
  );
}

export function AvatarPicker({ value, onChange, disabled }: { value: AvatarId; onChange: (avatar: AvatarId) => void; disabled?: boolean }) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Avatar">
      {AVATAR_IDS.map((id) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={LABELS[id]}
          title={LABELS[id]}
          className={value === id ? "avatar-choice selected" : "avatar-choice"}
          key={id}
          disabled={disabled}
          onClick={() => onChange(id)}
        >
          <Avatar avatar={id} />
        </button>
      ))}
    </div>
  );
}
