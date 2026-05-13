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
      db.executeSync(`ALTER TABLE sessions ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;`);
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
      db.executeSync(`ALTER TABLE plot_surveys ADD COLUMN plot_type TEXT NOT NULL DEFAULT 'fixed';`);
      db.executeSync(`ALTER TABLE plot_surveys ADD COLUMN track_geojson TEXT;`);

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
      db.executeSync(
        `ALTER TABLE plot_surveys ADD COLUMN track_finalized INTEGER NOT NULL DEFAULT 0;`,
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
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN sex TEXT;`);
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN life_stage TEXT;`);
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN reproductive_condition TEXT;`);
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN leaf_phenology TEXT;`);
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
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN organism_quantity TEXT;`);
        db.executeSync(`ALTER TABLE ${tbl} ADD COLUMN organism_quantity_type TEXT;`);
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
];

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
