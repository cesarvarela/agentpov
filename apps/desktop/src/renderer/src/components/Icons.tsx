import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function LogoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.75l5.5 3.1v6.3L8 14.25 2.5 11.15V4.85z" />
      <path d="M8 8.05l5.5-3.2M8 8.05v6.2M8 8.05L2.5 4.85" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.25 8h9.5M9.25 4.5L12.75 8l-3.5 3.5" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 3.75h4l1.5 2h7v6.5h-12.5z" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 1.75h5l3.5 3.5v9h-8.5z" />
      <path d="M8.5 1.75v3.5h3.5" />
    </Icon>
  );
}

export function DocIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 1.75h5l3.5 3.5v9h-8.5z" />
      <path d="M8.5 1.75v3.5h3.5" />
      <path d="M5.75 8.5h4.5M5.75 11h3" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4l4 4-4 4" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.75v10.5M2.75 8h10.5" />
    </Icon>
  );
}

export function FolderPlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 3.75h4l1.5 2h7v6.5h-12.5z" />
      <path d="M8 7.75v3M6.5 9.25h3" />
    </Icon>
  );
}

/**
 * VS Code style sidebar toggle. `filled` draws the left column solid, which is
 * how the mock marks the sidebar as visible.
 */
export function SidebarIcon({
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6 3v10" />
      {filled ? (
        <rect
          x="3.2"
          y="4.2"
          width="1.8"
          height="7.6"
          rx="0.9"
          fill="currentColor"
          stroke="none"
        />
      ) : null}
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.75 3.25l7 4.75-7 4.75z" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 8.75l3 3 7.5-7.5" />
    </Icon>
  );
}

export function MemoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
      <path d="M5.75 6.25h4.5M5.75 9.25h2.5" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.75l5 2v4.1c0 3-2 5.3-5 6.4-3-1.1-5-3.4-5-6.4V3.75z" />
    </Icon>
  );
}

export function HookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 2.75v5.5a3 3 0 01-6 0V6.5" />
      <path d="M3 4.75l2-2 2 2" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.9v.1" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5h-7v7" />
    </Icon>
  );
}

export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3.5v6a3 3 0 003 3h5" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.25l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.2v.1" />
    </Icon>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3" fill={color} />
    </svg>
  );
}
