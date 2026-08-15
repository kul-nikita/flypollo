export default function Logo({ size = 34, withText = false, className = "" }) {
  return (
    <span className={`logo ${withText ? "logo-with-text" : ""} ${className}`.trim()}>
      <img
        src="/logo.png"
        alt="FlyGamify"
        width={size}
        height={size}
        className="logo-img"
        draggable={false}
        style={{ borderRadius: "12%" }}
      />
      {withText && <span className="logo-text">FlyGamify</span>}
    </span>
  );
}
