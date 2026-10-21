import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  CirclePlus,
  DollarSign,
  Folder,
  Play,
  Plus,
  Search,
  Square,
  Tag,
  X,
  type LucideProps,
} from "lucide-react";

// Keep Hourlark's Lucide outlines in the measured timer slots.
export function FolderGlyph(props: LucideProps) {
  return <Folder width={16} height={13} aria-hidden="true" {...props} />;
}

export function TagGlyph(props: LucideProps) {
  return <Tag size={16} aria-hidden="true" {...props} />;
}

export function DollarGlyph(props: LucideProps) {
  return <DollarSign width={14} height={18} strokeWidth={3} aria-hidden="true" {...props} />;
}

export function PlayGlyph(props: LucideProps) {
  return <Play size={36} className="p-[9px]" strokeWidth={2.5} aria-hidden="true" {...props} />;
}

export function StopGlyph(props: LucideProps) {
  return <Square size={36} className="p-[9px]" strokeWidth={2.5} aria-hidden="true" {...props} />;
}

export function AddGlyph(props: LucideProps) {
  return <Plus size={36} className="p-1" strokeWidth={3} aria-hidden="true" {...props} />;
}

export function AutomaticModeGlyph(props: LucideProps) {
  return <CirclePlay size={16} aria-hidden="true" {...props} />;
}

export function ManualModeGlyph(props: LucideProps) {
  return <CirclePlus size={16} aria-hidden="true" {...props} />;
}

export function ArrowRightGlyph(props: LucideProps) {
  return <ArrowRight width={12} height={8} aria-hidden="true" {...props} />;
}

export function PlusGlyph(props: LucideProps) {
  return <Plus size={20} aria-hidden="true" {...props} />;
}

export function SearchGlyph(props: LucideProps) {
  return <Search size={14} aria-hidden="true" {...props} />;
}

export function ClearGlyph(props: LucideProps) {
  return <X size={10} aria-hidden="true" {...props} />;
}

export function ChevronGlyph({
  direction,
  ...props
}: LucideProps & { direction: "left" | "right" }) {
  const Chevron = direction === "left" ? ChevronLeft : ChevronRight;
  return <Chevron width={12} height={14} aria-hidden="true" {...props} />;
}
