/**
 * 「夜巡黑猫」自定义地图样式 —— 基于 OpenFreeMap 免费矢量瓦片（openmaptiles schema）。
 * 地名强制 name:zh（缺失时回退 name），彻底解决中英文混杂；
 * 深夜蓝黑底色让橙色轨迹成为唯一的视觉主角。
 */
import type { StyleSpecification } from 'maplibre-gl';

const COALESCE_ZH = ['coalesce', ['get', 'name:zh'], ['get', 'name']] as unknown as string[];

export function buildNightCatStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: { url: 'https://tiles.openfreemap.org/planet', type: 'vector' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0e17' } },

      // 自然
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'park']]],
        paint: { 'fill-color': '#0c1421', 'fill-opacity': 0.9 },
      },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#0e1c33' } },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: { 'line-color': '#0e1c33', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] },
      },

      // 道路（暗阶蓝色，仅作纹理，不抢轨迹戏）
      roadLayer('minor_service', ['in', ['get', 'class'], ['literal', ['minor', 'service', 'residential', 'pedestrian', 'track', 'path']]],
        '#131b2b', ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 2.2]),
      roadLayer('tertiary_secondary', ['in', ['get', 'class'], ['literal', ['tertiary', 'secondary']]],
        '#182340', ['interpolate', ['linear'], ['zoom'], 9, 0.5, 16, 3]),
      roadLayer('primary', ['==', ['get', 'class'], 'primary'],
        '#1e2b4a', ['interpolate', ['linear'], ['zoom'], 8, 0.6, 16, 3.6]),
      roadLayer('trunk_motorway', ['in', ['get', 'class'], ['literal', ['trunk', 'motorway']]],
        '#24345a', ['interpolate', ['linear'], ['zoom'], 6, 0.6, 16, 4.4]),
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        layout: { visibility: 'none' },
        paint: { 'line-color': '#182135', 'line-width': 0.8 },
      },

      // 行政边界
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 6],
        paint: {
          'line-color': '#223050',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.2],
          'line-dasharray': [3, 2],
        },
      },

      // 地名标注：全中文（name:zh 优先）
      ...placeLayer('label_country', ['in', ['get', 'class'], ['literal', ['continent', 'country', 'state']]],
        ['#4a5a78', '#41527a'], { min: 3, max: 8, sizes: [11, 13], bold: false, spacing: 260, letter: 2 }),
      ...placeLayer('label_city', ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        ['#8b99b4', '#6e7d99'], { min: 6, max: 15, sizes: [12, 16], bold: true, spacing: 180, letter: 1 }),
      ...placeLayer('label_small', ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'neighbourhood']]],
        ['#5b6a85', '#5b6a85'], { min: 12, max: 20, sizes: [11, 13], bold: false, spacing: 200, letter: 0 }),
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
        paint: { 'text-color': '#3d5a8a', 'text-halo-color': '#0a0e17', 'text-halo-width': 1.2 },
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
  opt: { min: number; max: number; sizes: [number, number]; bold: boolean; spacing: number; letter: number },
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
      'text-halo-color': '#0a0e17',
      'text-halo-width': 1.4,
    },
  });
  return [mk(true, opt.sizes[1], colors[0], opt.min), mk(false, opt.sizes[0], colors[1], opt.min)];
}
