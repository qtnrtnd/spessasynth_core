import type { GenericRange } from "../types";
import type { MIDIPatch } from "./midi_patch";

/**
 * One pad of a custom drum kit: a source drum (a kit `patch` + a `key`) mapped
 * onto a destination key in the assembled kit. See `BasicSoundBank.buildPreset`
 * and the concept doc `concept/audio/drums.md` §3–§4.
 */
export interface CustomKitSlot {
    /**
     * Destination key in the assembled kit (where this drum is played from).
     */
    destKey: number;

    /**
     * The source drum: the kit it is taken from (`patch`) and its `key` there.
     */
    source: {
        patch: MIDIPatch;
        key: number;
    };

    /**
     * Optional velocity window to take from the source (e.g. a single layer of a
     * multi-layer snare). Absent = the full velocity range (all layers).
     */
    velRange?: GenericRange;
}

/**
 * A compact recipe for assembling a custom drum kit as a new preset whose zones
 * reference samples already present in the target bank (no audio is copied).
 * Serializes as project data (a few bytes), cf. `concept/audio/drums.md` §5.
 */
export interface CustomKitRecipe {
    /**
     * The target bank id (in the sound bank manager) to assemble into, e.g.
     * `"main"`. Sources are resolved within, and the new preset is added to, this
     * same bank — so its zones can share the bank's samples.
     */
    id: string;

    /**
     * The assembled drum preset's MIDI patch (program/bank). Rebuilds in place if
     * a preset with this patch already exists.
     */
    patch: MIDIPatch;

    /**
     * Optional preset name. Defaults to `"Custom Kit"`.
     */
    name?: string;

    /**
     * The pads making up the kit.
     */
    slots: CustomKitSlot[];
}
