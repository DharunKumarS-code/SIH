export function extractBuildingProperties(feature) {
  // Get property names if available (Cesium3DTileFeature API)
  let propNames = [];
  if (typeof feature.getPropertyNames === 'function') {
    try {
      propNames = feature.getPropertyNames();
    } catch (e) {
      // ignore errors, fallback to raw properties object
    }
  }

  const rawProps = feature.properties || {};
  const result = {};

  const setIfValid = (key, value) => {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  };

  const knownKeys = [
    'elementType',
    'elementId',
    'estimatedHeight',
    'height',
    'longitude',
    'lat',
    'latitude',
    'building',
    'wikidata',
    'wikipedia',
    'name'
  ];

  // Extract known keys first
  knownKeys.forEach((k) => {
    let val;
    if (typeof feature.getProperty === 'function') {
      try { val = feature.getProperty(k); } catch (e) {}
    }
    if (val === undefined && rawProps[k] !== undefined) {
      val = rawProps[k];
    }
    if (typeof val === 'number') {
      if (['longitude', 'latitude', 'lat'].includes(k)) {
        val = Number(val.toFixed(5));
      } else if (['estimatedHeight', 'height'].includes(k)) {
        val = Number(val.toFixed(2));
      }
    }
    setIfValid(k, val);
  });

  // Add any additional properties not already captured
  if (propNames.length > 0) {
    propNames.forEach((p) => {
      if (result[p] !== undefined) return;
      let v;
      if (typeof feature.getProperty === 'function') {
        try { v = feature.getProperty(p); } catch (e) {}
      }
      if (v === undefined && rawProps[p] !== undefined) {
        v = rawProps[p];
      }
      setIfValid(p, v);
    });
  } else {
    Object.keys(rawProps).forEach((p) => {
      if (result[p] !== undefined) return;
      setIfValid(p, rawProps[p]);
    });
  }

  return result;
}
