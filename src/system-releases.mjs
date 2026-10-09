// Fontes: Google Drive (demais sistemas) + GitHub Actions aprovado (Obra na Mão), 2026-10-09.
// Somente 4 sistemas, NENHUM dos 63 kits. Obra 2.1.0 vem do artifact oficial de build da main.
// Fontes, tamanhos e hashes SHA-256 de binários reais verificados em 2026-10-09. GitHub Actions sincroniza com R2 após configuração autorizada.
// Manifesto sozinho não publica ofertas, não concede acesso ao comprador e não faz upload de bytes no deploy.
export const SYSTEM_RELEASES=Object.freeze([
  {
    "id": "obra-windows",
    "offerId": "obra-na-mao",
    "platform": "Windows",
    "version": "2.1.0",
    "fileName": "Obra-na-Mao-Desktop-Setup-2.1.0.exe",
    "size": 125774266,
    "source": "github-actions",
    "sourceUrl": "https://github.com/nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL/actions/runs/37495882884/artifacts/11427268634",
    "sha256": "6f8a310f7d4ea6cc48fa1c6fbfa5448b78a4a4e97e484da071611785889af6a2",
    "sourceCommit": "d9398be587c51319fb9f61979f9538b010063d45",
    "outdated": false,
    "key": "releases/obra-na-mao-obra-windows-Obra-na-Mao-Desktop-Setup-2.1.0.exe"
  },
  {
    "id": "pdv-artisys-windows",
    "offerId": "pdv-artisys-restaurantes",
    "platform": "Windows 10/11",
    "version": "Drive 2026-10-07",
    "fileName": "Instalador-ArtisysPDV-Windows10-11.exe",
    "size": 98109306,
    "driveId": "1hAu1EhTGtSf3npdxsjl0X_RpdeSGHlSV",
    "sha256": "00d6bc108a415637c171a8ff5fa631f9b0407cdc0baba80910908ff2403d6e8d",
    "outdated": false,
    "key": "releases/pdv-artisys-restaurantes-pdv-artisys-windows-Instalador-ArtisysPDV-Windows10-11.exe"
  },
  {
    "id": "pdv-artisys-mac-intel",
    "offerId": "pdv-artisys-restaurantes",
    "platform": "macOS Intel",
    "version": "Drive 2026-10-08",
    "fileName": "Instalador-ArtisysPDV-macOS-Intel.dmg",
    "size": 122669575,
    "driveId": "1CqxfNSHU8PTIL3XzYzwa5LcOZn5NwTdc",
    "sha256": "3f78cb766c2de963e8a9b86a42052c5510fade5f25ba4d93bd1123ad3610a3ab",
    "outdated": false,
    "key": "releases/pdv-artisys-restaurantes-pdv-artisys-mac-intel-Instalador-ArtisysPDV-macOS-Intel.dmg"
  },
  {
    "id": "pdv-artisys-mac-silicon",
    "offerId": "pdv-artisys-restaurantes",
    "platform": "macOS Apple Silicon",
    "version": "Drive 2026-10-08",
    "fileName": "Instalador-ArtisysPDV-macOS-AppleSilicon.dmg",
    "size": 117168141,
    "driveId": "1Lj2OY464T5vU5Xf5EOhUSkP0wOF3kjBz",
    "sha256": "1d981da6add52def7e80a93ad8deb332f92e0c55ac919e6c5ba9fdc0d12705fd",
    "outdated": false,
    "key": "releases/pdv-artisys-restaurantes-pdv-artisys-mac-silicon-Instalador-ArtisysPDV-macOS-AppleSilicon.dmg"
  },
  {
    "id": "pdv-nexus-win10",
    "offerId": "pdv-nexus",
    "platform": "Windows 10/11",
    "version": "Drive 2026-09-29",
    "fileName": "INSTALADOR-WINDOWS10.exe",
    "size": 94403609,
    "driveId": "1EXfLkUH7Jun6oMBkfljTQnUqtDAYOMAT",
    "sha256": "2ba3c380376bad5443613300f886ef093c2973798d5149e93ff9a99d4fd34a1b",
    "outdated": false,
    "key": "releases/pdv-nexus-pdv-nexus-win10-INSTALADOR-WINDOWS10.exe"
  },
  {
    "id": "pdv-nexus-win8",
    "offerId": "pdv-nexus",
    "platform": "Windows 8",
    "version": "Drive 2026-09-29",
    "fileName": "INSTALADOR-WINDOWS8.exe",
    "size": 65376681,
    "driveId": "1MI5V-OfCM4u9EL4m5ei3k_omRJ4xEKNw",
    "sha256": "f357c6ee0d6cedac49bebd1b9d67d1d89e007f2943252383f0f6dc1d7a80c866",
    "outdated": false,
    "key": "releases/pdv-nexus-pdv-nexus-win8-INSTALADOR-WINDOWS8.exe"
  },
  {
    "id": "pdv-nexus-win7",
    "offerId": "pdv-nexus",
    "platform": "Windows 7",
    "version": "Drive 2026-09-29",
    "fileName": "INSTALADOR-WINDOWS7.exe",
    "size": 69007120,
    "driveId": "1fxyWAOGPvpJ9zNaSBIxTVHNpbYlMSOkm",
    "sha256": "2bf1ffb70037f8f5c6b752f8536d081d5d557c819749ab52154cc492462e1bb7",
    "outdated": false,
    "key": "releases/pdv-nexus-pdv-nexus-win7-INSTALADOR-WINDOWS7.exe"
  },
  {
    "id": "financeiro-windows",
    "offerId": "artisys-sistema-financeiro",
    "platform": "Windows",
    "version": "0.1.0",
    "fileName": "ArtiSys-Financeiro-Setup-0.1.0.exe",
    "size": 118366655,
    "driveId": "12rwqtuaiM4vHRcByNhHNU5lvEE2mLDer",
    "sha256": "c33f578d3fba27742cab08cb948cfdc355a84d1148cd1e8b9c89cb357a0e8c8f",
    "outdated": false,
    "key": "releases/artisys-sistema-financeiro-financeiro-windows-ArtiSys-Financeiro-Setup-0.1.0.exe"
  }
]);
export const SYSTEM_RELEASE_BY_ID=new Map(SYSTEM_RELEASES.map(x=>[x.id,x]));
export const RELEASE_PART_SIZE=8*1024*1024;
