export default function Logo({ size = 34, withText = false, className = "" }) {
  return (
    <span className={`logo ${withText ? "logo-with-text" : ""} ${className}`.trim()}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="FlyPollo"
      >
        <defs>
          <linearGradient id="flypollo-logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#60a5fa" />
            <stop offset="1" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#flypollo-logo-g)" />
        <path
          d="M12 27h7l4-9 6 18 4-9h5"
          stroke="#ffffff"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withText && <span className="logo-text">FlyPollo</span>}
    </span>
  );
}
