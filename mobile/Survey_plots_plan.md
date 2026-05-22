# Vegetation survey plan


## Survey methods

1. boundary-based plot survey
2. bounaryless point count
3. line transect

## data models

1. Environmental data
   1. Including 
      plotid (mandatory, hereafter [M] in prefix)
      [M] coordinates (decimalLongitude, decimalLatitude), 
      [M] eventTimeStamp (including startTimestamp, stopTimestamp),
      [M] coordinateUncertaintyInMeters (GNSS errors),
      [M] sampleSizeValue (e.g. 5 [plot size or length of transect]),
      [M] sampleSizeUnit (e.g. square meters)
      [M] samplingProtocol (e.g. 方形樣區調查法, 穿越線調查法)
      elevation, slope, aspect, terrain position (ridge, upper slope, mid slope, lower slope, valley, plain),
      ratio of rock cover (岩石地比例, %), ratio of gravel cover (碎石比例, %), ratio of bareland cover (裸露地比例, %)
      [M] totalCoverInPercentage (total vegetation cover in %),
      [M] recordedBy (investigator, e.g. Cheng-Tao Lin. Multiple surverys are allowed)
      locality (e.g. 臺大校園總圖書館旁)
      fieldNote (i.e. comments)
   2. In the database schema, a uuid is required for each plot (point or polygon)/transect lines

2. Species data
   1. Species (with common name + scientific name for axillary data), but the taicol id should be automatically recorded
      When input a species, it should be matched with the taicol's db
   2. Vertical layer: E0 (moss/lichen layer), E1 (herbacious layer), E2 (shrub layer), E3 (tree layer) [EUNIS system]
      a. Coverage of each layer (i.e. E0, E1, E2, E3, unit: %)
      b. Height of each layer (unit: cm)
   3. Abundance data
      a. BraunBlanquet method: +, r, 1, 2, 3, 4, 5
      b. percentage (0-100%)
      c. DBH (diameter at breast height). unit is commonly cm

## Methods

1. 定點計數法
   1. 樣區編號(plotid, DwC: eventID)
   2. 開始時間、結束時間
   3. 座標
   4. 半徑


## input flow

1. Users has to input the environmental data first, input a plot id, then get GPS coordinates and errors. The other environmental data
   also need to be filled
2. User input species data
