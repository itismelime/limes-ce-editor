import { writeFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';

const ASSET_BASE = import.meta.env.BASE_URL || '/';

function toAssetUrl(assetPath: string): string {
  const cleanBase = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}/`;
  const cleanPath = assetPath.replace(/^\/+/, '');
  return `${cleanBase}${cleanPath}`;
}

export interface CeBundleEntry {
  folder: string;
  label: string;
  files: string[];
}

export const BUNDLED_CE_MAPS: Record<string, CeBundleEntry> = {
  namalsk: {
    folder: 'namalsk',
    label: 'Namalsk',
    files: [
      'namalsk.xml',
      'cfgAreaFlags.xml',
      'namalsk_background.bmp',
      'layers/tier1.tga',
      'layers/tier2.tga',
      'layers/tier3.tga',
      'layers/tier4.tga',
    ],
  },
  chernarus: {
    folder: 'chernarusplus',
    label: 'Chernarus+',
    files: [
      'chernarusplus.xml',
      'map.png',
      'layers/attractors.tga',
      'layers/keyPoint-Churches.tga',
      'layers/usgFlg_Def-All.tga',
      'layers/usgFlg_Def-Coast.tga',
      'layers/usgFlg_Def-Farm.tga',
      'layers/usgFlg_Def-Firefighter.tga',
      'layers/usgFlg_Def-Hunting.tga',
      'layers/usgFlg_Def-Industrial.tga',
      'layers/usgFlg_Def-Medic.tga',
      'layers/usgFlg_Def-Military.tga',
      'layers/usgFlg_Def-Office.tga',
      'layers/usgFlg_Def-Police.tga',
      'layers/usgFlg_Def-Prison.tga',
      'layers/usgFlg_Def-School.tga',
      'layers/usgFlg_Def-Town.tga',
      'layers/usgFlg_Def-Village.tga',
      'layers/usgFlg_Paint-Coast.tga',
      'layers/usgFlg_Paint-Contamination.tga',
      'layers/usgFlg_Paint-Farm.tga',
      'layers/usgFlg_Paint-Firefighter.tga',
      'layers/usgFlg_Paint-Historical.tga',
      'layers/usgFlg_Paint-Hunting.tga',
      'layers/usgFlg_Paint-Industrial.tga',
      'layers/usgFlg_Paint-Lunapark.tga',
      'layers/usgFlg_Paint-Medic.tga',
      'layers/usgFlg_Paint-Military.tga',
      'layers/usgFlg_Paint-Office.tga',
      'layers/usgFlg_Paint-Police.tga',
      'layers/usgFlg_Paint-Prison.tga',
      'layers/usgFlg_Paint-School.tga',
      'layers/usgFlg_Paint-Town.tga',
      'layers/usgFlg_Paint-Village.tga',
      'layers/valueFlg_Tier1.tga',
      'layers/valueFlg_Tier2.tga',
      'layers/valueFlg_Tier3.tga',
      'layers/valueFlg_Tier4.tga',
      'layers/valueFlg_Unique.tga',
      'layers/water-fresh.tga',
      'layers/water-sea.tga',
    ],
  },
  livonia: {
    folder: 'enoch',
    label: 'Livonia',
    files: [
      'enoch.xml',
      'map.png',
      'layers/elevation.tga',
      'layers/enoch_water.tga',
      'layers/spawning-Chapels.tga',
      'layers/spawning-Churches.tga',
      'layers/spawning-Ruins.tga',
      'layers/spawning-Sheds.tga',
      'layers/spawning-Special.tga',
      'layers/spawning-Universal.tga',
      'layers/spawning-Wrecks.tga',
      'layers/usgFlg_Def-All.tga',
      'layers/usgFlg_Def-Coast.tga',
      'layers/usgFlg_Def-Farm.tga',
      'layers/usgFlg_Def-Firefighter.tga',
      'layers/usgFlg_Def-Hunting.tga',
      'layers/usgFlg_Def-Industrial.tga',
      'layers/usgFlg_Def-Medic.tga',
      'layers/usgFlg_Def-Military.tga',
      'layers/usgFlg_Def-Office.tga',
      'layers/usgFlg_Def-Police.tga',
      'layers/usgFlg_Def-Prison.tga',
      'layers/usgFlg_Def-School.tga',
      'layers/usgFlg_Def-Stores.tga',
      'layers/usgFlg_Def-Town.tga',
      'layers/usgFlg_Def-Village.tga',
      'layers/usgFlg_Paint-Coast.tga',
      'layers/usgFlg_Paint-Contamination.tga',
      'layers/usgFlg_Paint-Farm.tga',
      'layers/usgFlg_Paint-Firefighter.tga',
      'layers/usgFlg_Paint-Hunting.tga',
      'layers/usgFlg_Paint-Industrial.tga',
      'layers/usgFlg_Paint-Lunapark.tga',
      'layers/usgFlg_Paint-Medic.tga',
      'layers/usgFlg_Paint-Military.tga',
      'layers/usgFlg_Paint-Office.tga',
      'layers/usgFlg_Paint-Police.tga',
      'layers/usgFlg_Paint-Prison.tga',
      'layers/usgFlg_Paint-School.tga',
      'layers/usgFlg_Paint-SeasonalEvent.tga',
      'layers/usgFlg_Paint-Special.tga',
      'layers/usgFlg_Paint-Town.tga',
      'layers/usgFlg_Paint-Village.tga',
      'layers/valueFlg_Tier1.tga',
      'layers/valueFlg_Tier2.tga',
      'layers/valueFlg_Tier3.tga',
      'layers/valueFlg_Tier4.tga',
      'layers/valueFlg_Unique.tga',
      'layers/water-fresh.tga',
    ],
  },
  sakhal: {
    folder: 'sakhal',
    label: 'Sakhal',
    files: [
      'sakhal.xml',
      'map.png',
      'layers/tex_sakhal_ice_lake.tga',
      'layers/tex_sakhal_ice_sea.tga',
      'layers/tex_sakhal_snow.tga',
      'layers/usgFlg_Def-All.tga',
      'layers/usgFlg_Def-Coast.tga',
      'layers/usgFlg_Def-Farm.tga',
      'layers/usgFlg_Def-Firefighter.tga',
      'layers/usgFlg_Def-Hunting.tga',
      'layers/usgFlg_Def-Industrial.tga',
      'layers/usgFlg_Def-Medic.tga',
      'layers/usgFlg_Def-Military.tga',
      'layers/usgFlg_Def-Office.tga',
      'layers/usgFlg_Def-Police.tga',
      'layers/usgFlg_Def-Prison.tga',
      'layers/usgFlg_Def-School.tga',
      'layers/usgFlg_Def-Stores.tga',
      'layers/usgFlg_Def-Town.tga',
      'layers/usgFlg_Def-Village.tga',
      'layers/usgFlg_Paint-Coast.tga',
      'layers/usgFlg_Paint-Contamination.tga',
      'layers/usgFlg_Paint-Farm.tga',
      'layers/usgFlg_Paint-Firefighter.tga',
      'layers/usgFlg_Paint-Hunting.tga',
      'layers/usgFlg_Paint-Industrial.tga',
      'layers/usgFlg_Paint-Lunapark.tga',
      'layers/usgFlg_Paint-Medic.tga',
      'layers/usgFlg_Paint-Military.tga',
      'layers/usgFlg_Paint-Office.tga',
      'layers/usgFlg_Paint-Police.tga',
      'layers/usgFlg_Paint-Prison.tga',
      'layers/usgFlg_Paint-School.tga',
      'layers/usgFlg_Paint-SeasonalEvent.tga',
      'layers/usgFlg_Paint-Special.tga',
      'layers/usgFlg_Paint-Town.tga',
      'layers/usgFlg_Paint-Village.tga',
      'layers/valueFlg_Tier1.tga',
      'layers/valueFlg_Tier2.tga',
      'layers/valueFlg_Tier3.tga',
      'layers/valueFlg_Tier4.tga',
      'layers/valueFlg_Unique.tga',
    ],
  },
  nasdara: {
    folder: 'nasdara',
    label: 'Nasdara',
    files: [
      'nasdara.xml',
      'map.png',
      'layers/usgFlg_Def-All.tga',
      'layers/usgFlg_Def-Coast.tga',
      'layers/usgFlg_Def-Farm.tga',
      'layers/usgFlg_Def-Firefighter.tga',
      'layers/usgFlg_Def-Hunting.tga',
      'layers/usgFlg_Def-Industrial.tga',
      'layers/usgFlg_Def-Medic.tga',
      'layers/usgFlg_Def-Military.tga',
      'layers/usgFlg_Def-MilitaryEast.tga',
      'layers/usgFlg_Def-MilitaryWest.tga',
      'layers/usgFlg_Def-Office.tga',
      'layers/usgFlg_Def-Police.tga',
      'layers/usgFlg_Def-Prison.tga',
      'layers/usgFlg_Def-School.tga',
      'layers/usgFlg_Def-Town.tga',
      'layers/usgFlg_Def-Village.tga',
      'layers/usgFlg_Paint-Coast.tga',
      'layers/usgFlg_Paint-Contamination.tga',
      'layers/usgFlg_Paint-Farm.tga',
      'layers/usgFlg_Paint-Firefighter.tga',
      'layers/usgFlg_Paint-Historical.tga',
      'layers/usgFlg_Paint-Hunting.tga',
      'layers/usgFlg_Paint-Industrial.tga',
      'layers/usgFlg_Paint-Lunapark.tga',
      'layers/usgFlg_Paint-Medic.tga',
      'layers/usgFlg_Paint-Military.tga',
      'layers/usgFlg_Paint-MilitaryEast.tga',
      'layers/usgFlg_Paint-MilitaryWest.tga',
      'layers/usgFlg_Paint-Office.tga',
      'layers/usgFlg_Paint-Police.tga',
      'layers/usgFlg_Paint-Prison.tga',
      'layers/usgFlg_Paint-School.tga',
      'layers/usgFlg_Paint-Town.tga',
      'layers/usgFlg_Paint-Village.tga',
      'layers/valueFlg_Tier1.tga',
      'layers/valueFlg_Tier2.tga',
      'layers/valueFlg_Tier3.tga',
      'layers/valueFlg_Tier4.tga',
      'layers/valueFlg_Unique.tga',
      'layers/water-fresh.tga',
      'layers/water-sea.tga',
    ],
  },
};

export async function deployBundledCeProject(mapId: string, missionPath: string): Promise<void> {
  const entry = BUNDLED_CE_MAPS[mapId];
  if (!entry) throw new Error(`No bundled CE project for map: ${mapId}`);

  const targetBase = `${missionPath}/CETool/${entry.folder}`;

  for (const file of entry.files) {
    const srcUrl = toAssetUrl(`cetool/${entry.folder}/${file}`);
    const destPath = `${targetBase}/${file}`;

    const dirPath = destPath.slice(0, destPath.lastIndexOf('/'));
    await mkdir(dirPath, { recursive: true });

    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error(`Failed to fetch bundled asset: ${srcUrl}`);

    if (file.endsWith('.xml')) {
      await writeTextFile(destPath, await res.text());
    } else {
      await writeFile(destPath, new Uint8Array(await res.arrayBuffer()));
    }
  }
}
