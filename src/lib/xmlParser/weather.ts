import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { WeatherData, WeatherValue } from '../../types/dayz';
import { PARSER_OPTIONS, BUILDER_OPTIONS, stripBom, num } from './shared';

export function parseWeatherXml(raw: string): WeatherData {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const root = doc?.weather ?? {};

  return {
    reset:         num(root['@_reset'], 1),
    enable:        num(root['@_enable'], 1),
    overcast:      parseWeatherValue(root.overcast      as Record<string, unknown> ?? {}),
    fog:           parseWeatherValue(root.fog           as Record<string, unknown> ?? {}),
    rain:          parseWeatherValue(root.rain          as Record<string, unknown> ?? {}),
    windMagnitude: parseWeatherValue(root.windMagnitude as Record<string, unknown> ?? {}),
    windDirection: parseWeatherValue(root.windDirection as Record<string, unknown> ?? {}),
    snowfall:      parseWeatherValue(root.snowfall      as Record<string, unknown> ?? {}),
    storm: {
      density:      num((root.storm as Record<string, unknown>)?.['@_density'],   0),
      threshold:    num((root.storm as Record<string, unknown>)?.['@_threshold'], 1),
      timeout:      num((root.storm as Record<string, unknown>)?.['@_timeout'],  60),
      rawDensity:   String((root.storm as Record<string, unknown>)?.['@_density']   ?? ''),
      rawThreshold: String((root.storm as Record<string, unknown>)?.['@_threshold'] ?? ''),
    },
    rawData: root,
  };
}

export function serializeWeatherXml(weather: WeatherData): string {
  const root = weather.rawData
    ? JSON.parse(JSON.stringify(weather.rawData)) as Record<string, unknown>
    : {};
  root['@_reset']  = String(weather.reset);
  root['@_enable'] = String(weather.enable);
  root.overcast      = serializeWeatherValue(weather.overcast,      true,  false);
  root.fog           = serializeWeatherValue(weather.fog,           true,  false);
  root.rain          = serializeWeatherValue(weather.rain,          true,  true);
  root.windMagnitude = serializeWeatherValue(weather.windMagnitude, true,  false);
  root.windDirection = serializeWeatherValue(weather.windDirection, true,  false);
  root.snowfall      = serializeWeatherValue(weather.snowfall,      true,  true);
  root.storm = {
    '@_density':   weather.storm.rawDensity?.trim()   || String(weather.storm.density),
    '@_threshold': weather.storm.rawThreshold?.trim() || String(weather.storm.threshold),
    '@_timeout':   String(weather.storm.timeout),
  };
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
    `<!-- Default Namalsk weather init, do not change if you are using the event system -->\n` +
    builder.build({ weather: root });
}

function parseWeatherValue(obj: Record<string, unknown>): WeatherValue {
  const current      = obj.current      as Record<string, unknown> | undefined;
  const limits       = obj.limits       as Record<string, unknown> | undefined;
  const timelimits   = obj.timelimits   as Record<string, unknown> | undefined;
  const changelimits = obj.changelimits as Record<string, unknown> | undefined;
  const thresholds   = obj.thresholds   as Record<string, unknown> | undefined;

  return {
    current: {
      actual:    num(current?.['@_actual'], 0),
      time:      num(current?.['@_time'],   0),
      duration:  num(current?.['@_duration'], 0),
      rawActual: String(current?.['@_actual'] ?? ''),
    },
    limits: {
      min:    num(limits?.['@_min'], 0),
      max:    num(limits?.['@_max'], 0),
      rawMin: String(limits?.['@_min'] ?? ''),
      rawMax: String(limits?.['@_max'] ?? ''),
    },
    ...(timelimits ? {
      timelimits: {
        min: num(timelimits['@_min'], 0),
        max: num(timelimits['@_max'], 0),
      },
    } : {}),
    ...(changelimits ? {
      changelimits: {
        min:    num(changelimits['@_min'], 0),
        max:    num(changelimits['@_max'], 0),
        rawMin: String(changelimits['@_min'] ?? ''),
        rawMax: String(changelimits['@_max'] ?? ''),
      },
    } : {}),
    ...(thresholds ? {
      thresholds: {
        min: num(thresholds['@_min'], 0),
        max: num(thresholds['@_max'], 0),
        end: num(thresholds['@_end'], 0),
      },
    } : {}),
  };
}

function serializeWeatherValue(
  value: WeatherValue,
  includeTimelimits: boolean,
  includeThresholds: boolean,
): Record<string, unknown> {
  return {
    current: {
      '@_actual':   value.current.rawActual?.trim() || String(value.current.actual),
      '@_time':     String(value.current.time),
      '@_duration': String(value.current.duration),
    },
    limits: {
      '@_min': value.limits.rawMin?.trim() || String(value.limits.min),
      '@_max': value.limits.rawMax?.trim() || String(value.limits.max),
    },
    ...(includeTimelimits && value.timelimits ? {
      timelimits: {
        '@_min': String(value.timelimits.min),
        '@_max': String(value.timelimits.max),
      },
    } : {}),
    ...(value.changelimits ? {
      changelimits: {
        '@_min': value.changelimits.rawMin?.trim() || String(value.changelimits.min),
        '@_max': value.changelimits.rawMax?.trim() || String(value.changelimits.max),
      },
    } : {}),
    ...(includeThresholds && value.thresholds ? {
      thresholds: {
        '@_min': String(value.thresholds.min),
        '@_max': String(value.thresholds.max),
        '@_end': String(value.thresholds.end),
      },
    } : {}),
  };
}
