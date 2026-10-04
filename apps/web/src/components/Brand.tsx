const wordmark = "/brand/01_logo/png/linkbox-wordmark-transparent.png";
const fullLogo = "/brand/01_logo/png/linkbox-logo-full-transparent.png";

export function Brand({ large = false }: { large?: boolean }) {
  return <div className={`brand ${large ? "brand-large" : ""}`}>
    {large ? <span className="brand-full-frame">
      <img className="brand-full" src={fullLogo} alt="LinkBox" width="130" height="127"/>
      <img className="brand-full brand-dark-lettering" src={fullLogo} alt="" aria-hidden="true" width="130" height="127"/>
    </span> : <><span className="brand-symbol" aria-hidden="true"><img className="brand-symbol-art" src={fullLogo} alt="" width="901" height="883"/></span><span className="brand-wordmark-frame">
      <img className="brand-wordmark" src={wordmark} alt="LinkBox" width="900" height="336"/>
      <img className="brand-wordmark brand-dark-lettering" src={wordmark} alt="" aria-hidden="true" width="900" height="336"/>
    </span></>}
  </div>;
}
