import type { GameplayData } from '../../types/dayz';
import { num } from './shared';

export function parseGameplayJson(raw: string): GameplayData {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const playerData = data.PlayerData as Record<string, unknown> | undefined;
  const worldsData = data.WorldsData as Record<string, unknown> | undefined;

  return {
    version: num(data.version, 1),
    PlayerData: playerData ? {
      ShockHandlingData: playerData.ShockHandlingData ? {
        shockRefillSpeedUnconscious: num((playerData.ShockHandlingData as Record<string, unknown>).shockRefillSpeedUnconscious, 3),
        rawValue: JSON.stringify(playerData.ShockHandlingData),
      } : undefined,
      StaminaData: playerData.StaminaData ? {
        sprintStaminaModifierErc:           num((playerData.StaminaData as Record<string, unknown>).sprintStaminaModifierErc, 0),
        sprintStaminaModifierCro:           num((playerData.StaminaData as Record<string, unknown>).sprintStaminaModifierCro, 0),
        staminaWeightLimitThreshold:        num((playerData.StaminaData as Record<string, unknown>).staminaWeightLimitThreshold, 999999),
        staminaMax:                         num((playerData.StaminaData as Record<string, unknown>).staminaMax, 150),
        staminaKgToStaminaPercentPenalty:   num((playerData.StaminaData as Record<string, unknown>).staminaKgToStaminaPercentPenalty, 0),
        staminaMinCap:                      num((playerData.StaminaData as Record<string, unknown>).staminaMinCap, 5),
        sprintSwimmingStaminaModifier:      num((playerData.StaminaData as Record<string, unknown>).sprintSwimmingStaminaModifier, 0),
        sprintLadderStaminaModifier:        num((playerData.StaminaData as Record<string, unknown>).sprintLadderStaminaModifier, 0),
        meleeStaminaModifier:               num((playerData.StaminaData as Record<string, unknown>).meleeStaminaModifier, 1),
        obstacleTraversalStaminaModifier:   num((playerData.StaminaData as Record<string, unknown>).obstacleTraversalStaminaModifier, 0),
        holdBreathStaminaModifier:          num((playerData.StaminaData as Record<string, unknown>).holdBreathStaminaModifier, 1),
        rawValues: { ...playerData.StaminaData as Record<string, string> },
      } : undefined,
    } : undefined,
    WorldsData: worldsData ? {
      environmentMinTemps: worldsData.environmentMinTemps ? (worldsData.environmentMinTemps as number[]) : undefined,
      environmentMaxTemps: worldsData.environmentMaxTemps ? (worldsData.environmentMaxTemps as number[]) : undefined,
      rawMinTemps: JSON.stringify(worldsData.environmentMinTemps),
      rawMaxTemps: JSON.stringify(worldsData.environmentMaxTemps),
    } : undefined,
    rawData: data,
  };
}

export function serializeGameplayJson(gameplay: GameplayData): string {
  const result: Record<string, unknown> = gameplay.rawData
    ? JSON.parse(JSON.stringify(gameplay.rawData)) as Record<string, unknown>
    : {};

  result.version = gameplay.version;

  if (gameplay.PlayerData) {
    const existingPlayerData = (result.PlayerData as Record<string, unknown> | undefined) ?? {};
    result.PlayerData = { ...existingPlayerData };
    const pd = result.PlayerData as Record<string, unknown>;

    if (gameplay.PlayerData.ShockHandlingData) {
      const existingShock = (pd.ShockHandlingData as Record<string, unknown> | undefined) ?? {};
      let parsedRawShock: Record<string, unknown> = {};
      if (gameplay.PlayerData.ShockHandlingData.rawValue) {
        try {
          parsedRawShock = JSON.parse(gameplay.PlayerData.ShockHandlingData.rawValue) as Record<string, unknown>;
        } catch {
          parsedRawShock = {};
        }
      }
      pd.ShockHandlingData = {
        ...existingShock,
        ...parsedRawShock,
        shockRefillSpeedUnconscious: gameplay.PlayerData.ShockHandlingData.shockRefillSpeedUnconscious,
      };
    }

    if (gameplay.PlayerData.StaminaData) {
      const sd = gameplay.PlayerData.StaminaData;
      const existingStamina = (pd.StaminaData as Record<string, unknown> | undefined) ?? {};
      pd.StaminaData = {
        ...existingStamina,
        sprintStaminaModifierErc:         sd.sprintStaminaModifierErc,
        sprintStaminaModifierCro:         sd.sprintStaminaModifierCro,
        staminaWeightLimitThreshold:      sd.staminaWeightLimitThreshold,
        staminaMax:                       sd.staminaMax,
        staminaKgToStaminaPercentPenalty: sd.staminaKgToStaminaPercentPenalty,
        staminaMinCap:                    sd.staminaMinCap,
        sprintSwimmingStaminaModifier:    sd.sprintSwimmingStaminaModifier,
        sprintLadderStaminaModifier:      sd.sprintLadderStaminaModifier,
        meleeStaminaModifier:             sd.meleeStaminaModifier,
        obstacleTraversalStaminaModifier: sd.obstacleTraversalStaminaModifier,
        holdBreathStaminaModifier:        sd.holdBreathStaminaModifier,
      };
    }
  }

  if (gameplay.WorldsData) {
    const existingWorldsData = (result.WorldsData as Record<string, unknown> | undefined) ?? {};
    result.WorldsData = {
      ...existingWorldsData,
      ...(gameplay.WorldsData.environmentMinTemps ? { environmentMinTemps: gameplay.WorldsData.environmentMinTemps } : {}),
      ...(gameplay.WorldsData.environmentMaxTemps ? { environmentMaxTemps: gameplay.WorldsData.environmentMaxTemps } : {}),
    };
  }

  return JSON.stringify(result, null, '\t');
}
