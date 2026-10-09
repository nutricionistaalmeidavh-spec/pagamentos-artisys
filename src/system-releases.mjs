// Fontes: Google Drive (demais sistemas) + GitHub Actions aprovado (Obra na Mão), 2026-10-09.
// Somente 4 sistemas, NENHUM dos 63 kits. Obra 2.1.0 vem do artifact oficial de build da main.
// O manifest registra origem, NÃO transfere arquivos nem aprova publicação.
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
    "outdated": false,
    "key": "releases/artisys-sistema-financeiro-financeiro-windows-ArtiSys-Financeiro-Setup-0.1.0.exe"
  }
]);
export const SYSTEM_RELEASE_BY_ID=new Map(SYSTEM_RELEASES.map(x=>[x.id,x]));
export const RELEASE_PART_SIZE=8*1024*1024;
