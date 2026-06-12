export default function Fab({
  onClick,
  icon,
  label,
  className = '',
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-900/50 active:scale-95 active:bg-indigo-500 transition-transform ${className}`}
    >
      {icon}
    </button>
  );
}
