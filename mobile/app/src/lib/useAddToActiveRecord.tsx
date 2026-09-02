/**
 * Shared "add this species to whatever record is active" smart router.
 *
 * Single source of truth for the decision the identification-key runner
 * (`app/key/[id].tsx::addTaxonToActiveRecord`) already makes correctly, so the
 * taxonomy tree / 查詢 entry points stop blindly adding to a session (which,
 * via single-active enforcement, would silently end an active plot survey).
 *
 * Priority: active plot → open PlotSpeciesValueModal (enter abundance) →
 * addPlotSpecies. Otherwise active session (or a freshly started one) →
 * addRecord. Returns the modal element so the host screen can render it.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  addPlotSpecies,
  addRecord,
  addSpecimen,
  createCollectionTrip,
  getActiveCollectionTrip,
  isTaxonInSession,
  nextRecordNumber,
  type Layer,
  type SearchResult,
} from '~/db';
import type { AdoptionInput } from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { useToast } from '~/stores/toast';
import { defaultQuantityTypeFor } from './dwcAbundance';
import { serializeMultiAttribute } from './dwcAttributes';
import { showActionSheet } from '~/components/ActionSheet';
import {
  PlotSpeciesValueModal,
  type PlotModalHeader,
  type PlotValueDraft,
} from '~/components/PlotSpeciesValueModal';
import type { PlotType } from '~/db';

type PlotTarget = {
  sp: SearchResult;
  plotId: number;
  plotType: PlotType;
  layer: Layer;
  /** Survives the trip through the abundance modal. */
  adopted?: AdoptionInput | null;
};

function headerOf(sp: SearchResult): PlotModalHeader {
  return {
    cname: sp.cname ?? '',
    name: sp.name,
    author: sp.fullname.replace(sp.name, '').trim(),
    kingdom: sp.kingdom ?? '',
    phylum: sp.phylum ?? '',
    class_name: sp.class_name ?? '',
    order: sp.order ?? '',
    family: sp.family ?? '',
    family_c: sp.family_cname ?? '',
    genus: sp.genus ?? '',
  };
}

export function useAddToActiveRecord(): {
  addSpecies: (sp: SearchResult, adopted?: AdoptionInput | null) => void;
  /** Explicit collection route, reached by long-pressing the add button.
   *  Never taken by `addSpecies` — collections stay off the default path so the
   *  existing plot → session behaviour is unchanged. */
  addToCollection: (sp: SearchResult) => void;
  modal: React.ReactNode;
  /** Dynamic button label reflecting where the next add will land. */
  targetLabel: string;
  /** Long-press companion to `addSpecies`: asks which record the species should
   *  go to. Wire it to the add button's `onLongPress` so a plain tap keeps its
   *  existing, unchanged behaviour.
   *
   *  Await it before dismissing any host sheet — iOS cannot present this over a
   *  Modal that is being torn down in the same tick. Resolves true when the
   *  species was added, false when the chooser was cancelled, so the host can
   *  keep itself open on cancel. */
  promptAddDestination: (sp: SearchResult) => Promise<boolean>;
} {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const plot = useActivePlot((s) => s.plot);
  const session = useActiveSession((s) => s.session);
  const startSession = useActiveSession((s) => s.start);
  const [plotTarget, setPlotTarget] = useState<PlotTarget | null>(null);

  const targetLabel = plot ? t('addToRecord.toPlot') : session ? t('addToRecord.toSession') : t('addToRecord.newSession');

  const addSpecies = (sp: SearchResult, adopted?: AdoptionInput | null) => {
    if (!sp.taxon_id) {
      toast(t('addToRecord.noTaxonId'));
      return;
    }
    // Read the active plot fresh to avoid a stale closure.
    const activePlot = useActivePlot.getState().plot;
    if (activePlot) {
      // Non-stratified plots (transect / point count) store every row under
      // 'T'; fixed plots default to E2 (草本層), matching the key runner.
      const layer: Layer = activePlot.plot_type === 'fixed' ? 'E2' : 'T';
      setPlotTarget({ sp, plotId: activePlot.id, plotType: activePlot.plot_type, layer, adopted });
      return;
    }
    // Session path (or start a fresh one).
    const target = session ?? startSession();
    if (isTaxonInSession(target.id, sp.taxon_id)) {
      toast(t('addToRecord.alreadyInRecord', { name: sp.cname || sp.name }));
      return;
    }
    addRecord({ session_id: target.id, taxon_id: sp.taxon_id, adopted });
    useActiveSession.getState().refresh();
    toast(t('session.added', { name: sp.cname || sp.name }), {
      action: { label: t('addToRecord.goTo'), onPress: () => router.push(`/session/${target.id}`) },
    });
  };

  /**
   * Add a specimen to the open collection trip, starting one if none is open.
   * Number / time / collector are prefilled; the rest is filled in afterwards on
   * the specimen sheet, mirroring how a checklist record is added then detailed.
   */
  const addToCollection = (sp: SearchResult) => {
    if (!sp.taxon_id) {
      toast(t('addToRecord.noTaxonId'));
      return;
    }
    const trip = getActiveCollectionTrip();
    const tripId = trip?.id ?? createCollectionTrip();
    const number = nextRecordNumber().text;
    addSpecimen({ trip_id: tripId, taxon_id: sp.taxon_id, record_number: number });
    toast(t('addToRecord.addedToCollection', { number, name: sp.cname || sp.name }), {
      action: { label: t('addToRecord.goTo'), onPress: () => router.push(`/collection/${tripId}`) },
    });
  };

  const promptAddDestination = async (sp: SearchResult): Promise<boolean> => {
    // Resolved here rather than during render: this is a synchronous SQLite
    // read, and the hook is mounted by the taxonomy tree, which re-renders on
    // every scroll and expand.
    const activeTrip = getActiveCollectionTrip();
    const idx = await showActionSheet({
      title: sp.cname || sp.name,
      options: [
        { label: targetLabel },
        {
          label: activeTrip
            ? t('addToRecord.toCollection', { name: activeTrip.name })
            : t('addToRecord.newCollection'),
        },
      ],
      cancelLabel: t('common.cancel'),
    });
    if (idx === 0) {
      addSpecies(sp);
      return true;
    }
    if (idx === 1) {
      addToCollection(sp);
      return true;
    }
    return false; // cancelled — the host stays open
  };

  const handlePlotSave = (v: PlotValueDraft) => {
    if (!plotTarget) return;
    const { sp, plotId, layer, adopted } = plotTarget;
    addPlotSpecies({
      plot_survey_id: plotId,
      taxon_id: sp.taxon_id,
      layer,
      adopted,
      organism_quantity: v.organism_quantity,
      organism_quantity_type: v.organism_quantity_type,
      notes: v.notes,
      sex: v.sex,
      life_stage: v.life_stage,
      reproductive_condition: serializeMultiAttribute(v.reproductive_condition),
      leaf_phenology: serializeMultiAttribute(v.leaf_phenology),
      detection_type: v.detection_type,
    });
    setPlotTarget(null);
    useActivePlot.getState().refresh();
    toast(t('addToRecord.addedToPlot', { name: sp.cname || sp.name }), {
      action: { label: t('addToRecord.goTo'), onPress: () => router.push(`/plot/${plotId}`) },
    });
  };

  const modal = plotTarget ? (
    <PlotSpeciesValueModal
      visible
      layer={plotTarget.layer}
      title={`${plotTarget.sp.cname || ''} ${plotTarget.sp.name}`.trim()}
      header={headerOf(plotTarget.sp)}
      kingdom={plotTarget.sp.kingdom ?? null}
      className={plotTarget.sp.class_name ?? null}
      defaultType={defaultQuantityTypeFor(plotTarget.sp.kingdom)}
      showDetection={plotTarget.plotType === 'point_count' || plotTarget.sp.kingdom === 'Animalia'}
      onCancel={() => setPlotTarget(null)}
      onSave={handlePlotSave}
    />
  ) : null;

  return {
    addSpecies,
    addToCollection,
    promptAddDestination,
    modal,
    targetLabel,
  };
}
