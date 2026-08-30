import type { DB } from '@op-engineering/op-sqlite';

type Migration = {
  version: number;
  up: (db: DB) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          abstract TEXT,
          location_description TEXT,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.executeSync(`
        INSERT OR IGNORE INTO projects (id, name, created_at, updated_at)
        VALUES (0, '未分類', strftime('%s','now')*1000, strftime('%s','now')*1000);
      `);
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'checklist',
          project_id INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          gps_mode TEXT,
          start_lat REAL,
          start_lng REAL,
          track_geojson TEXT,
          notes TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;`);
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS checklist_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          taxon_id TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          notes TEXT,
          photo_paths TEXT,
          lat REAL,
          lng REAL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_records_session ON checklist_records(session_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_records_taxon ON checklist_records(taxon_id);`);
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS search_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          searched_at INTEGER NOT NULL
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_history_searched ON search_history(searched_at DESC);`);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL DEFAULT 0,
          session_id INTEGER,
          name TEXT NOT NULL,
          geometry_type TEXT NOT NULL CHECK (geometry_type IN (
            'Point','LineString','Polygon',
            'MultiPoint','MultiLineString','MultiPolygon'
          )),
          geometry_geojson TEXT NOT NULL,
          color TEXT,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_project ON sites(project_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_session ON sites(session_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);`);
    },
  },
  {
    // v3: extend sites geometry_type CHECK to include Multi* types.
    // For installs already on v2 with the old CHECK, recreate the table.
    // SQLite cannot ALTER a CHECK constraint, so rename + create + copy + drop.
    version: 3,
    up: (db) => {
      db.executeSync(`ALTER TABLE sites RENAME TO sites_v2;`);
      db.executeSync(`
        CREATE TABLE sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL DEFAULT 0,
          session_id INTEGER,
          name TEXT NOT NULL,
          geometry_type TEXT NOT NULL CHECK (geometry_type IN (
            'Point','LineString','Polygon',
            'MultiPoint','MultiLineString','MultiPolygon'
          )),
          geometry_geojson TEXT NOT NULL,
          color TEXT,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );
      `);
      db.executeSync(`
        INSERT INTO sites (id, project_id, session_id, name, geometry_type, geometry_geojson, color, notes, created_at, updated_at)
        SELECT id, project_id, session_id, name, geometry_type, geometry_geojson, color, notes, created_at, updated_at FROM sites_v2;
      `);
      db.executeSync(`DROP TABLE sites_v2;`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_project ON sites(project_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_session ON sites(session_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sites_updated ON sites(updated_at DESC);`);
    },
  },
  {
    // v4: sessions can optionally reference a site (e.g., revisit of a known plot).
    // Most sessions will have NULL site_id; site capture is opt-in.
    version: 4,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE sessions ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_sessions_site ON sessions(site_id);`);
    },
  },
  {
    // v5: vegetation plot survey tables (Phase 3).
    // plot_surveys = environmental data (Darwin Core aligned columns) + per-layer
    // cover/height/method. plot_species_records = one row per (species, layer)
    // pairing with method-specific value (bb_value / percent / dbh_values_json).
    // Bidirectional link with sites: plot_surveys.site_id references sites.id.
    version: 5,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS plot_surveys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL UNIQUE,
          plotid TEXT NOT NULL,
          project_id INTEGER NOT NULL DEFAULT 0,
          site_id INTEGER,
          start_ts INTEGER,
          stop_ts INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          -- DwC core
          decimal_longitude REAL,
          decimal_latitude REAL,
          coord_uncertainty_m REAL,
          sample_size_value REAL,
          sample_size_unit TEXT,
          sampling_protocol TEXT,
          total_cover_pct REAL,
          recorded_by TEXT,
          locality TEXT,
          field_note TEXT,
          -- env (optional)
          elevation_m REAL,
          slope_deg REAL,
          aspect_deg REAL,
          terrain_position TEXT,
          rock_cover_pct REAL,
          gravel_cover_pct REAL,
          bareland_cover_pct REAL,
          -- per-layer cover (%) + height (cm)
          e0_cover_pct REAL,
          e0_height_cm REAL,
          e1_cover_pct REAL,
          e1_height_cm REAL,
          e2_cover_pct REAL,
          e2_height_cm REAL,
          e3_cover_pct REAL,
          e3_height_cm REAL,
          -- per-layer abundance method: 'BB' | 'percent' | 'DBH'
          e0_method TEXT NOT NULL DEFAULT 'BB',
          e1_method TEXT NOT NULL DEFAULT 'BB',
          e2_method TEXT NOT NULL DEFAULT 'BB',
          e3_method TEXT NOT NULL DEFAULT 'DBH',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_surveys_project ON plot_surveys(project_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_surveys_site ON plot_surveys(site_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_surveys_started ON plot_surveys(start_ts DESC);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_surveys_active ON plot_surveys(status) WHERE status = 'active';`);
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS plot_species_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plot_survey_id INTEGER NOT NULL,
          taxon_id TEXT NOT NULL,
          layer TEXT NOT NULL CHECK (layer IN ('E0','E1','E2','E3')),
          -- exactly one of these is populated per record, dictated by the
          -- corresponding plot_surveys.<layer>_method.
          bb_value TEXT,             -- '+', 'r', '1'..'5'
          percent REAL,              -- 0..100
          dbh_values_json TEXT,      -- JSON array of cm values for multi-stem
          notes TEXT,
          photo_paths TEXT,          -- JSON array of photo URIs
          observed_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (plot_survey_id) REFERENCES plot_surveys(id) ON DELETE CASCADE
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_plot ON plot_species_records(plot_survey_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_taxon ON plot_species_records(taxon_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_layer ON plot_species_records(plot_survey_id, layer);`);
    },
  },
  {
    // v6: support transect plots alongside fixed (4-layer) plots.
    //   * plot_surveys.plot_type ('fixed' | 'transect')，預設 'fixed'
    //   * plot_surveys.track_geojson — transect 軌跡 (LineString GeoJSON)
    //   * plot_species_records.layer 的 CHECK 擴增 'T'（transect 不分層）。
    //     SQLite 不支援 ALTER CHECK，因此 rename+create+copy 重建表。
    version: 6,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN plot_type TEXT NOT NULL DEFAULT 'fixed';`);
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN track_geojson TEXT;`);

      db.executeSync(`ALTER TABLE plot_species_records RENAME TO plot_species_records_old;`);
      db.executeSync(`
        CREATE TABLE plot_species_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plot_survey_id INTEGER NOT NULL,
          taxon_id TEXT NOT NULL,
          layer TEXT NOT NULL CHECK (layer IN ('E0','E1','E2','E3','T')),
          bb_value TEXT,
          percent REAL,
          dbh_values_json TEXT,
          notes TEXT,
          photo_paths TEXT,
          observed_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (plot_survey_id) REFERENCES plot_surveys(id) ON DELETE CASCADE
        );
      `);
      db.executeSync(`
        INSERT INTO plot_species_records
          (id, plot_survey_id, taxon_id, layer, bb_value, percent, dbh_values_json, notes, photo_paths, observed_at, created_at)
        SELECT id, plot_survey_id, taxon_id, layer, bb_value, percent, dbh_values_json, notes, photo_paths, observed_at, created_at
        FROM plot_species_records_old;
      `);
      db.executeSync(`DROP TABLE plot_species_records_old;`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_plot ON plot_species_records(plot_survey_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_taxon ON plot_species_records(taxon_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_plot_records_layer ON plot_species_records(plot_survey_id, layer);`);
    },
  },
  {
    // v7: transect track finalization flag.
    //   * track_finalized = 1 表示軌跡已停止儲存，不可再 append；plot 仍可加物種。
    //   * track_geojson 格式從 LineString 升級為 MultiLineString（segment 陣列），
    //     由 code 層處理；DB schema 不變（TEXT GeoJSON）。
    version: 7,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN track_finalized INTEGER NOT NULL DEFAULT 0;`,
      );
    },
  },
  {
    // v8: DwC species attribute columns shared by checklist_records and
    // plot_species_records.
    //   * sex                     DwC sex
    //   * life_stage              DwC lifeStage (動物，依 class 不同 enum)
    //   * reproductive_condition  DwC reproductiveCondition (植物花/果)
    //   * leaf_phenology          dynamicProperties.leafPhenology (植物葉)
    version: 8,
    up: (db) => {
      for (const tbl of ['checklist_records', 'plot_species_records']) {
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN sex TEXT;`);
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN life_stage TEXT;`);
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN reproductive_condition TEXT;`);
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN leaf_phenology TEXT;`);
      }
    },
  },
  {
    // v9: DwC abundance generalization.
    //   * organism_quantity       DwC organismQuantity (string; may carry
    //                             a JSON array for multi-stem DBH)
    //   * organism_quantity_type  DwC organismQuantityType
    //   Existing bb_value / percent / dbh_values_json data is migrated into
    //   the new pair of columns; the legacy columns are kept for now (SQLite
    //   DROP COLUMN is painful and the export pipeline still references them).
    version: 9,
    up: (db) => {
      for (const tbl of ['checklist_records', 'plot_species_records']) {
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN organism_quantity TEXT;`);
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN organism_quantity_type TEXT;`);
      }
      // Migrate plot_species_records (only this table has the legacy abundance
      // columns; checklist_records never carried abundance data).
      db.executeSync(`
        UPDATE plot_species_records
        SET organism_quantity = bb_value,
            organism_quantity_type = 'Braun-Blanquet Scale'
        WHERE bb_value IS NOT NULL AND organism_quantity IS NULL;
      `);
      db.executeSync(`
        UPDATE plot_species_records
        SET organism_quantity = CAST(percent AS TEXT),
            organism_quantity_type = '% cover'
        WHERE percent IS NOT NULL AND organism_quantity IS NULL;
      `);
      db.executeSync(`
        UPDATE plot_species_records
        SET organism_quantity = dbh_values_json,
            organism_quantity_type = 'DBH (cm)'
        WHERE dbh_values_json IS NOT NULL AND organism_quantity IS NULL;
      `);
    },
  },
  {
    // v10: capture per-record GPS accuracy (meters) so DwC
    // `coordinateUncertaintyInMeters` can be populated on export.
    // expo-location returns `pos.coords.accuracy` for free; without a column
    // to land it in we were dropping it on the floor.
    version: 10,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE checklist_records ADD COLUMN accuracy REAL;`);
    },
  },
  {
    // v11: track when a session / plot was last resumed (status: done → active
    // toggle). Stale-record watchers were using `started_at` as the baseline,
    // which triggers a noisy "已開了 72 小時" alert the moment a user reopens
    // a 3-day-old record to add one more taxon. With `resumed_at` populated on
    // reopen, the watcher can compute the baseline as
    // `MAX(started_at, resumed_at, latest_activity)` and only warn when the
    // ACTIVE session has genuinely been idle/running too long.
    version: 11,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE sessions ADD COLUMN resumed_at INTEGER;`);
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN resumed_at INTEGER;`);
    },
  },
  {
    // v12: normalise per-layer environmental data into `plot_survey_layers`
    // (1..6 rows per plot) and expand the vegetation profile from 4 fixed
    // layers (E0-E3) to a user-configurable 1-6 layers with fixed semantic
    // labels. Adds env_photos_json for plot-wide environment context photos.
    //
    // Label shift (preserves ecological meaning):
    //   old E0 苔蘚 → new E1 (layer_index 1)
    //   old E1 草本 → new E2 (layer_index 2)
    //   old E2 灌木 → new E3 (layer_index 3)
    //   old E3 喬木 → new E4 (layer_index 4)
    //   (new) E5 主林冠層 (layer_index 5)
    //   (new) E6 突出層   (layer_index 6)
    //
    // plot_surveys.e0_*..e3_* columns are KEPT in this migration to allow
    // emergency rollback by reading the legacy columns. v13 will drop them
    // after production stability is verified.
    version: 12,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE plot_survey_layers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plot_survey_id INTEGER NOT NULL,
          layer_index INTEGER NOT NULL CHECK (layer_index BETWEEN 1 AND 6),
          cover_pct REAL,
          height_cm REAL,
          method TEXT NOT NULL DEFAULT 'BB' CHECK (method IN ('BB','percent','DBH')),
          FOREIGN KEY (plot_survey_id) REFERENCES plot_surveys(id) ON DELETE CASCADE,
          UNIQUE(plot_survey_id, layer_index)
        );
      `);
      db.executeSync(
        `CREATE INDEX idx_plot_survey_layers_plot ON plot_survey_layers(plot_survey_id);`,
      );

      // layer_count default 4 = existing plots keep 4 layers (E1-E4). User can
      // bump to 6 via the env tab; lowered count just hides the trailing
      // layers in UI, the data stays for safety.
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN layer_count INTEGER NOT NULL DEFAULT 4 CHECK (layer_count BETWEEN 1 AND 6);`,
      );
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN env_photos_json TEXT;`);

      // Backfill: every existing FIXED plot gets 4 layer rows from its
      // e0_*..e3_* columns (transect plots have no layer concept).
      for (let i = 0; i < 4; i++) {
        const col = `e${i}`;
        const newIndex = i + 1;
        db.executeSync(
          `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, cover_pct, height_cm, method)
           SELECT id, ?, ${col}_cover_pct, ${col}_height_cm, ${col}_method
           FROM plot_surveys
           WHERE plot_type = 'fixed';`,
          [newIndex],
        );
      }

      // plot_species_records: rebuild table to:
      //   (a) update CHECK from ('E0'..'E3','T') → ('E1'..'E6','T')
      //   (b) shift existing layer values E0..E3 → E1..E4 (transect 'T' unchanged)
      // Must preserve every column that subsequent migrations added (v8 attrs,
      // v9 organism_quantity pair).
      db.executeSync(`ALTER TABLE plot_species_records RENAME TO plot_species_records_old_v11;`);
      db.executeSync(`
        CREATE TABLE plot_species_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plot_survey_id INTEGER NOT NULL,
          taxon_id TEXT NOT NULL,
          layer TEXT NOT NULL CHECK (layer IN ('E1','E2','E3','E4','E5','E6','T')),
          bb_value TEXT,
          percent REAL,
          dbh_values_json TEXT,
          notes TEXT,
          photo_paths TEXT,
          observed_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          sex TEXT,
          life_stage TEXT,
          reproductive_condition TEXT,
          leaf_phenology TEXT,
          organism_quantity TEXT,
          organism_quantity_type TEXT,
          FOREIGN KEY (plot_survey_id) REFERENCES plot_surveys(id) ON DELETE CASCADE
        );
      `);
      db.executeSync(`
        INSERT INTO plot_species_records
          (id, plot_survey_id, taxon_id, layer, bb_value, percent, dbh_values_json,
           notes, photo_paths, observed_at, created_at,
           sex, life_stage, reproductive_condition, leaf_phenology,
           organism_quantity, organism_quantity_type)
        SELECT id, plot_survey_id, taxon_id,
          CASE layer
            WHEN 'E0' THEN 'E1'
            WHEN 'E1' THEN 'E2'
            WHEN 'E2' THEN 'E3'
            WHEN 'E3' THEN 'E4'
            ELSE layer
          END,
          bb_value, percent, dbh_values_json, notes, photo_paths, observed_at, created_at,
          sex, life_stage, reproductive_condition, leaf_phenology,
          organism_quantity, organism_quantity_type
        FROM plot_species_records_old_v11;
      `);
      db.executeSync(`DROP TABLE plot_species_records_old_v11;`);
      db.executeSync(`CREATE INDEX idx_plot_records_plot ON plot_species_records(plot_survey_id);`);
      db.executeSync(`CREATE INDEX idx_plot_records_taxon ON plot_species_records(taxon_id);`);
      db.executeSync(
        `CREATE INDEX idx_plot_records_layer ON plot_species_records(plot_survey_id, layer);`,
      );
    },
  },
  {
    // v13: per-record GPS + detection method on plot species records, and a
    // radius column on plot_surveys for the new 定點計數法 (point count) survey
    // type. All additive ALTERs — no table rebuild:
    //   - plot_species_records.layer CHECK is untouched: point count reuses the
    //     'T' bucket (disambiguated by plot_surveys.plot_type), so no rebuild.
    //   - plot_surveys.plot_type is TEXT DEFAULT 'fixed' with no CHECK, so the
    //     new 'point_count' literal is a pure code/type change.
    // `accuracy` mirrors checklist_records.accuracy so the same
    // updateRecordLocation-shaped helper + DwC mapper key apply unchanged.
    //
    // op-sqlite runs each executeSync in autocommit (no transaction wrapper);
    // the version row is inserted only after up() returns. If the process dies
    // mid-way, v13 re-runs from the top and ADD COLUMN (not IF NOT EXISTS)
    // would throw "duplicate column". This is the same latent risk every prior
    // multi-ALTER version carries (v8/v9/v11) and matches convention — we do
    // not introduce a transaction wrapper here. The MAX(version) gate in
    // runUserMigrations is the existing self-heal.
    version: 13,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_species_records ADD COLUMN lat REAL;`);
      addColumnIfMissing(db, `ALTER TABLE plot_species_records ADD COLUMN lng REAL;`);
      addColumnIfMissing(db, `ALTER TABLE plot_species_records ADD COLUMN accuracy REAL;`);
      addColumnIfMissing(db, `ALTER TABLE plot_species_records ADD COLUMN detection_type TEXT;`);
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN point_radius_m REAL;`);
    },
  },
  {
    // v14: 常用名錄 (favorite taxa). User-curated shortlist of frequently used
    // taxa for fast field entry. Denormalised display/sort columns are copied
    // from the matched TaiCOL row at add-time so the list renders offline
    // without a per-row join against twnamelist.db. taxon_id PK dedupes.
    version: 14,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS favorite_taxa (
          taxon_id TEXT PRIMARY KEY,
          simple_name TEXT,
          common_name_c TEXT,
          family TEXT,
          family_c TEXT,
          rank TEXT,
          kingdom TEXT,
          added_at INTEGER NOT NULL
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_favorite_added ON favorite_taxa(added_at DESC);`);
    },
  },
  {
    // v15: 常用調查者 (surveyors / DwC recordedBy). A curated list of people who
    // can be auto-filled (is_default) or picked when creating a record. Also
    // adds sessions.recorded_by (plot_surveys already has it from v5) so quick
    // checklists carry recordedBy too.
    version: 15,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS surveyors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          is_default INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
      addColumnIfMissing(db, `ALTER TABLE sessions ADD COLUMN recorded_by TEXT;`);
    },
  },
  {
    // v16: DwC occurrenceID (stable v4 uuid) per species occurrence, on both
    // checklist_records (快速名錄) and plot_species_records (樣區). New rows get
    // a uuid from generateUuid() at insert; existing rows are backfilled here
    // with a per-row v4 uuid built from SQLite randomblob (no JS needed, avoids
    // a migrations→plots import cycle).
    version: 16,
    up: (db) => {
      const uuidExpr = `lower(
        hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' ||
        hex(randomblob(6))
      )`;
      for (const tbl of ['checklist_records', 'plot_species_records']) {
        addColumnIfMissing(db, `ALTER TABLE ${tbl} ADD COLUMN occurrence_id TEXT;`);
        db.executeSync(
          `UPDATE ${tbl} SET occurrence_id = ${uuidExpr} WHERE occurrence_id IS NULL;`,
        );
      }
    },
  },
  {
    // v17: per-layer height unit (cm / m). height_cm stays the canonical stored
    // value (always cm); height_unit only controls how it is displayed in the
    // env tab and which column name + value the export emits.
    version: 17,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_survey_layers ADD COLUMN height_unit TEXT NOT NULL DEFAULT 'cm';`,
      );
    },
  },
  {
    // v18: fixed-plot subplots (小區). A fixed plot can be split into N subplots;
    // each subplot records its own per-layer cover/height (subplot_layers) and
    // its own species (plot_species_records.subplot_id). The layer DEFINITION
    // (layer_count + per-layer method + height_unit) stays shared at plot level
    // in plot_survey_layers. subplot_id NULL = un-split plot (legacy behaviour).
    version: 18,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS plot_subplots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plot_survey_id INTEGER NOT NULL,
          idx INTEGER NOT NULL,
          label TEXT NOT NULL,
          width_m REAL,
          length_m REAL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (plot_survey_id) REFERENCES plot_surveys(id) ON DELETE CASCADE,
          UNIQUE(plot_survey_id, idx)
        );
      `);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_plot_subplots_plot ON plot_subplots(plot_survey_id);`,
      );
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS subplot_layers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subplot_id INTEGER NOT NULL,
          layer_index INTEGER NOT NULL CHECK (layer_index BETWEEN 1 AND 6),
          cover_pct REAL,
          height_cm REAL,
          FOREIGN KEY (subplot_id) REFERENCES plot_subplots(id) ON DELETE CASCADE,
          UNIQUE(subplot_id, layer_index)
        );
      `);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_subplot_layers_subplot ON subplot_layers(subplot_id);`,
      );
      addColumnIfMissing(db, `ALTER TABLE plot_species_records ADD COLUMN subplot_id INTEGER;`);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_plot_records_subplot ON plot_species_records(subplot_id);`,
      );
    },
  },
  {
    // v19: specimen collection (標本採集). A collection trip (採集行程) groups the
    // specimens gathered on one outing, mirroring how `sessions` groups
    // `checklist_records`.
    //
    // `status` here is COLLECTION-LOCAL: it only decides which trip an "add to
    // collection" lands in. It deliberately does NOT participate in the app-wide
    // single-active invariant, so creating or reopening a trip never ends an
    // active session or plot survey (and vice versa).
    version: 19,
    up: (db) => {
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS collection_trips (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          project_id INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          recorded_by TEXT,
          locality TEXT,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
      `);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_ctrips_started ON collection_trips(started_at DESC);`,
      );
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_ctrips_project ON collection_trips(project_id);`);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_ctrips_active ON collection_trips(status) WHERE status = 'active';`,
      );
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS collection_specimens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trip_id INTEGER NOT NULL,
          occurrence_id TEXT,
          taxon_id TEXT NOT NULL,
          record_number TEXT NOT NULL,
          record_number_seq INTEGER,
          collected_at INTEGER NOT NULL,
          recorded_by TEXT,
          lat REAL,
          lng REAL,
          accuracy REAL,
          locality TEXT,
          reproductive_condition TEXT,
          leaf_phenology TEXT,
          notes TEXT,
          photo_paths TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (trip_id) REFERENCES collection_trips(id) ON DELETE CASCADE
        );
      `);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_cspec_trip ON collection_specimens(trip_id);`);
      db.executeSync(`CREATE INDEX IF NOT EXISTS idx_cspec_taxon ON collection_specimens(taxon_id);`);
      db.executeSync(
        `CREATE INDEX IF NOT EXISTS idx_cspec_seq ON collection_specimens(record_number_seq DESC);`,
      );
    },
  },
  {
    // v20: sex / life_stage on specimens, so the collection detail sheet can
    // show the same taxon-driven DwC attribute set as checklist and plot
    // records — `SpeciesAttributesBlock` gives sex to every kingdom, lifeStage
    // to animals and phenology to plants. v19 shipped with only the two
    // phenology columns, which limited specimens to plants in practice.
    //
    // Mirrors v8, which added the same four columns to checklist_records and
    // plot_species_records. Additive ALTERs, no table rebuild; carries the same
    // known property as v8/v9/v11/v13 — the runner has no transaction wrapper,
    // so a crash between the two statements re-runs both and ADD COLUMN throws
    // "duplicate column" (see the v13 note; deliberately not changed here).
    version: 20,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE collection_specimens ADD COLUMN sex TEXT;`);
      addColumnIfMissing(db, `ALTER TABLE collection_specimens ADD COLUMN life_stage TEXT;`);
    },
  },
  {
    // v21: three more ground-cover fractions on plot surveys, alongside the
    // existing rock / gravel / bareland trio. These record the *living* cover
    // (vascular plants, bryophytes, lichens) that the substrate columns don't:
    //   vascular_cover_pct   維管束植物覆蓋
    //   bryophyte_cover_pct  苔蘚覆蓋   (surface cover of bryophytes)
    //   lichen_cover_pct     地表地衣覆蓋 (surface cover of lichens)
    //
    // Additive ALTERs, same shape and caveat as v20 (no transaction wrapper;
    // a crash mid-way re-runs all three and ADD COLUMN throws duplicate column).
    version: 21,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN vascular_cover_pct REAL;`);
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN bryophyte_cover_pct REAL;`);
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN lichen_cover_pct REAL;`);
    },
  },
  {
    // v22: litterfall cover (枯落物覆蓋) — dead organic matter on the ground,
    // sitting between the living cover added in v21 and the mineral substrate
    // (rock / gravel / bareland) that has been there since v5.
    version: 22,
    up: (db) => {
      addColumnIfMissing(db, `ALTER TABLE plot_surveys ADD COLUMN litter_cover_pct REAL;`);
    },
  },
];

/** Highest schema version this build knows how to produce. Backup/restore uses
 *  it to refuse a backup made by a newer app (whose schema this build can't
 *  satisfy). */
/** Column names of `table`; empty when the table does not exist. */
function columnsOf(db: DB, table: string): Set<string> {
  // PRAGMA cannot be parameterised; the table name always comes from our own
  // SQL literals in this file, never from user input.
  const res = db.executeSync(`PRAGMA table_info(${table});`);
  return new Set(
    ((res.rows ?? []) as { name?: string }[]).map((r) => String(r.name ?? '')),
  );
}

/**
 * Re-runnable `ALTER TABLE … ADD COLUMN`.
 *
 * Every ADD COLUMN in this file used to be bare, so replaying a migration
 * against a table that already had the column threw `duplicate column name`.
 * That is not hypothetical: the old `clearAllUserData` dropped only some
 * tables and then replayed from v1, dying at v6 on `plot_type` and leaving a
 * DB that bricked the app on next launch. The v13 / v20 / v21 comments in this
 * file already flag the same hazard for a crash mid-migration.
 *
 * Skipping when the column exists makes every migration idempotent, which is
 * what lets a half-applied schema heal itself on the next run.
 */
function addColumnIfMissing(db: DB, sql: string): void {
  const m = sql.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?/i);
  if (!m) {
    db.executeSync(sql);
    return;
  }
  if (columnsOf(db, m[1]).has(m[2])) return;
  db.executeSync(sql);
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function runUserMigrations(db: DB): Promise<void> {
  db.executeSync(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const result = db.executeSync(`SELECT MAX(version) AS v FROM schema_version;`);
  const current = (result.rows?.[0]?.v as number | null) ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    migration.up(db);
    db.executeSync(`INSERT INTO schema_version (version) VALUES (?);`, [migration.version]);
  }
}
