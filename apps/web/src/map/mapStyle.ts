/**
 * 猫踪自定义地图样式 —— OpenFreeMap 免费矢量瓦片（openmaptiles schema）。
 * 夜巡（night）/ 晨巡（day）双主题；地名强制 name:zh（缺失回退 name）。
 * 瓦片/字体一律走本服务 /tiles/*（后端直连转发），浏览器不直连外网域名。
 */
import type { StyleSpecification } from 'maplibre-gl';

export type TrailTheme = 'night' | 'day';

/** 同源瓦片代理前缀（style 对象在浏览器构建，location 一定存在） */
const TILES = `${location.origin}/tiles`;

// 简体优先：港台等地的 name:zh 常为繁体，数据自带 name:zh-Hans 简体字段
const COALESCE_ZH = [
  'coalesce',
  ['get', 'name:zh-Hans'],
  ['get', 'name:zh'],
  ['get', 'name'],
] as unknown as string[];

const PALETTES = {
  night: {
    bg: '#0a0e17',
    landcover: '#0c1421',
    water: '#0e1c33',
    roadMinor: '#131b2b',
    roadSecondary: '#182340',
    roadPrimary: '#1e2b4a',
    roadTrunk: '#24345a',
    boundary: '#223050',
    labelCountry: ['#4a5a78', '#41527a'] as [string, string],
    labelCity: ['#8b99b4', '#6e7d99'] as [string, string],
    labelSmall: ['#5b6a85', '#5b6a85'] as [string, string],
    labelWater: '#3d5a8a',
    halo: '#0a0e17',
  },
  day: {
    bg: '#f4f1e8',
    landcover: '#eae6d8',
    water: '#b7cfd9',
    roadMinor: '#ffffff',
    roadSecondary: '#f0ece1',
    roadPrimary: '#eae4d6',
    roadTrunk: '#e3dcc9',
    boundary: '#d8d2c2',
    labelCountry: ['#a09a8c', '#8f8878'] as [string, string],
    labelCity: ['#3f4753', '#6a7180'] as [string, string],
    labelSmall: ['#8a8578', '#8a8578'] as [string, string],
    labelWater: '#6f96a8',
    halo: '#ffffff',
  },
} as const;

/** 轨迹配色随主题微调（浅色底上用更深的橙保证对比度） */
export function trailPalette(theme: TrailTheme) {
  return theme === 'day'
    ? { track: '#e8551f', halo: '#ff7a45', glow: 'rgba(232, 85, 31, 0.25)', hi: '#7a2c0d' }
    : { track: '#ff6b35', halo: '#ff8a5c', glow: 'rgba(255, 107, 53, 0.22)', hi: '#ffe9d6' };
}

export function buildStyle(theme: TrailTheme): StyleSpecification {
  const P = PALETTES[theme];
  return {
    version: 8,
    glyphs: `${TILES}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      openmaptiles: {
        url: `${TILES}/planet`,
        type: 'vector',
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
          ' · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': P.bg } },

      // 自然
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'park']]],
        paint: { 'fill-color': P.landcover, 'fill-opacity': 0.9 },
      },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': P.water } },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: { 'line-color': P.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] },
      },

      // 道路（低饱和纹理，不抢轨迹戏）
      roadLayer('minor_service', ['in', ['get', 'class'], ['literal', ['minor', 'service', 'residential', 'pedestrian', 'track', 'path']]],
        P.roadMinor, ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 2.2]),
      roadLayer('tertiary_secondary', ['in', ['get', 'class'], ['literal', ['tertiary', 'secondary']]],
        P.roadSecondary, ['interpolate', ['linear'], ['zoom'], 9, 0.5, 16, 3]),
      roadLayer('primary', ['==', ['get', 'class'], 'primary'],
        P.roadPrimary, ['interpolate', ['linear'], ['zoom'], 8, 0.6, 16, 3.6]),
      roadLayer('trunk_motorway', ['in', ['get', 'class'], ['literal', ['trunk', 'motorway']]],
        P.roadTrunk, ['interpolate', ['linear'], ['zoom'], 6, 0.6, 16, 4.4]),

      // 行政边界
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 6],
        paint: {
          'line-color': P.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.2],
          'line-dasharray': [3, 2],
        },
      },

      // 地名标注：全中文（name:zh 优先）
      ...placeLayer('label_country', ['in', ['get', 'class'], ['literal', ['continent', 'country', 'state']]],
        P.labelCountry, P.halo, { min: 3, max: 8, sizes: [11, 13], bold: false, letter: 2 }),
      ...placeLayer('label_city', ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        P.labelCity, P.halo, { min: 6, max: 15, sizes: [12, 16], bold: true, letter: 1 }),
      ...placeLayer('label_small', ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'neighbourhood']]],
        P.labelSmall, P.halo, { min: 12, max: 20, sizes: [11, 13], bold: false, letter: 0 }),
      {
        id: 'label_water',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: {
          'text-field': COALESCE_ZH,
          'text-font': ['Noto Sans Italic'],
          'text-size': 12,
          'text-letter-spacing': 0.3,
        },
        paint: { 'text-color': P.labelWater, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
      },
    ],
  };
}

function roadLayer(id: string, filter: unknown, color: string, width: unknown) {
  return {
    id,
    type: 'line' as const,
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter,
    paint: { 'line-color': color, 'line-width': width },
  };
}

function placeLayer(
  id: string,
  filter: unknown,
  colors: [string, string],
  halo: string,
  opt: { min: number; max: number; sizes: [number, number]; bold: boolean; letter: number },
) {
  const mk = (bold: boolean, size: number, color: string, minzoom: number) => ({
    id: bold ? id : `${id}_small`,
    type: 'symbol' as const,
    source: 'openmaptiles',
    'source-layer': 'place',
    filter,
    minzoom,
    layout: {
      'text-field': COALESCE_ZH,
      'text-font': [bold ? 'Noto Sans Bold' : 'Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], opt.min, opt.sizes[0], opt.max, opt.sizes[1]],
      'text-letter-spacing': opt.letter * 0.05,
      'text-max-width': 8,
    },
    paint: {
      'text-color': color,
      'text-halo-color': halo,
      'text-halo-width': 1.4,
    },
  });
  return [mk(true, opt.sizes[1], colors[0], opt.min), mk(false, opt.sizes[0], colors[1], opt.min)];
}
