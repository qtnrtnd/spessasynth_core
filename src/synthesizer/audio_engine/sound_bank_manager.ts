import type {
    MIDISystem,
    SoundBankManagerListEntry
} from "../../soundbank/types";
import type { BasicSoundBank } from "../../soundbank/basic_soundbank/basic_soundbank";
import { BasicPreset } from "../../soundbank/basic_soundbank/basic_preset";
import {
    type MIDIPatch,
    type MIDIPatchFull,
    MIDIPatchTools
} from "../../soundbank/basic_soundbank/midi_patch";
import type { CustomKitRecipe } from "../../soundbank/basic_soundbank/custom_kit";
import { BankSelectHacks } from "../../utils/midi_hacks";
import { SpessaLog } from "../../utils/loggin";

class SoundBankManagerPreset extends BasicPreset {
    public constructor(p: BasicPreset, offset: number) {
        super(p.parentSoundBank, p.globalZone);
        this.bankMSB = BankSelectHacks.addBankOffset(p.bankMSB, offset, true);

        this.name = p.name;
        this.bankLSB = p.bankLSB;
        this.isGMGSDrum = p.isGMGSDrum;
        this.program = p.program;

        this.genre = p.genre;
        this.morphology = p.morphology;
        this.library = p.library;
        this.zones = p.zones;
    }
}

export class SoundBankManager {
    /**
     * All the sound banks, ordered from the most important to the least.
     */
    public soundBankList: SoundBankManagerListEntry[] = [];
    private readonly presetListChangeCallback: () => unknown;

    private selectablePresetList: SoundBankManagerPreset[] = [];

    /**
     * @param presetListChangeCallback Supplied by the parent synthesizer class,
     * this is called whenever the preset list changes.
     */
    public constructor(presetListChangeCallback: () => unknown) {
        this.presetListChangeCallback = presetListChangeCallback;
    }

    private _presetList: MIDIPatchFull[] = [];

    /**
     * The list of all presets in the sound bank stack.
     */
    public get presetList() {
        return [...this._presetList];
    }

    /**
     * The current sound bank priority order.
     * @returns The IDs of the sound banks in the current order.
     */
    public get priorityOrder() {
        return this.soundBankList.map((s) => s.id);
    }

    /**
     * The current sound bank priority order.
     * @param newList The new order of sound bank IDs.
     */
    public set priorityOrder(newList: string[]) {
        this.soundBankList.sort(
            (a, b) => newList.indexOf(a.id) - newList.indexOf(b.id)
        );
        this.generatePresetList();
    }

    /**
     * Deletes a given sound bank by its ID.
     * @param id the ID of the sound bank to delete.
     */
    public deleteSoundBank(id: string) {
        if (this.soundBankList.length === 0) {
            SpessaLog.warn("1 soundbank left. Aborting!");
            return;
        }
        const index = this.soundBankList.findIndex((s) => s.id === id);
        if (index === -1) {
            throw new Error(`No sound bank with id "${id}"`);
        }
        this.soundBankList.splice(index, 1);
        this.generatePresetList();
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Adds a new sound bank with a given ID, or replaces an existing one.
     * @param font the sound bank to add.
     * @param id the ID of the sound bank.
     * @param bankOffset the bank offset of the sound bank.
     */
    public addSoundBank(font: BasicSoundBank, id: string, bankOffset = 0) {
        const foundBank = this.soundBankList.find((s) => s.id === id);
        if (foundBank === undefined) {
            this.soundBankList.push({
                id: id,
                soundBank: font,
                bankOffset: bankOffset
            });
        } else {
            // Replace
            foundBank.soundBank = font;
            foundBank.bankOffset = bankOffset;
        }
        this.generatePresetList();
    }

    /**
     * Injects audio data into lazy samples of a given bank (network-lazy
     * loading). The caller must invalidate the voice cache afterwards
     * (`SynthProcessor.clearCache`) so skipped voices re-resolve.
     *
     * The injected data is SF3, i.e. Vorbis, and it is **decoded here** rather
     * than left to first use. `BasicSample.getAudioData` decodes synchronously,
     * and its first caller is the voice cache — inside `process()`, on the audio
     * thread, at the instant a note is attacked. Measured: 6 to 25 ms per sample,
     * against a render quantum's budget of 2.7 ms, so a note reaching a sample
     * nobody had played yet costs up to ten missed deadlines — a click, and time
     * the transport never gets back (the playhead is extrapolated on
     * `AudioContext.currentTime`). Every injection instead happens while nothing
     * is playing — the palette floor during the lobby, a turn's voices under the
     * countdown — so this is the one moment the cost is free. Same intent as the
     * unused `BasicPreset.preload`, against the set of samples that was actually
     * asked for rather than a key range.
     *
     * It is paid in one block: 250 ms for the largest batch measured. That is
     * silence against silence today. Should samples ever be fetched while the
     * monitor runs, this is where the work would have to be spread over several
     * messages instead.
     * @param id the bank to inject into.
     * @param samples the sample data keyed by `sampleId` (index in `samples`).
     */
    public loadSamples(
        id: string,
        samples: { sampleId: number; data: ArrayBuffer }[]
    ) {
        const entry = this.soundBankList.find((s) => s.id === id);
        if (!entry) {
            SpessaLog.warn(`loadSamples: no sound bank "${id}".`);
            return;
        }
        const bankSamples = entry.soundBank.samples;
        for (const { sampleId, data } of samples) {
            const sample = bankSamples[sampleId];
            if (!sample) {
                SpessaLog.warn(`loadSamples: no sample ${sampleId} in "${id}".`);
                continue;
            }
            sample.setCompressedData(new Uint8Array(data));
            /* Guarded one by one: an unreadable sample must not take the rest
               of the batch down with it. A preset short of one range is
               playable; a preset that never installed is silent. */
            try {
                sample.getAudioData();
            } catch (error) {
                SpessaLog.warn(
                    `loadSamples: could not decode sample ${sampleId} in "${id}": ${String(error)}`
                );
            }
        }
    }

    /**
     * Assembles a custom drum kit into a bank as a new selectable preset (cf.
     * `BasicSoundBank.buildPreset` and `concept/audio/drums.md` §3). Regenerates
     * the preset list, which invalidates the synth's voice cache via the change
     * callback, so the new preset is immediately playable.
     * @param recipe the kit recipe (its `id` selects the target bank).
     */
    public buildPreset(recipe: CustomKitRecipe) {
        const entry = this.soundBankList.find((s) => s.id === recipe.id);
        if (!entry) {
            SpessaLog.warn(`buildPreset: no sound bank "${recipe.id}".`);
            return;
        }
        entry.soundBank.buildPreset(recipe);
        this.generatePresetList();
    }

    /**
     * Gets a given preset from the sound bank stack.
     * @param patch The MIDI patch to search for.
     * @param system The MIDI system to select the preset for.
     * @returns An object containing the preset and its bank offset.
     * @internal
     */
    public getPreset(
        patch: MIDIPatch,
        system: MIDISystem
    ): BasicPreset | undefined {
        if (
            this.soundBankList.length === 0 ||
            this.selectablePresetList.length === 0
        ) {
            return undefined;
        }

        return MIDIPatchTools.selectPatch(
            this.selectablePresetList,
            patch,
            system
        );
    }

    // Clears the sound bank list and destroys all sound banks.
    public destroy() {
        for (const s of this.soundBankList) {
            s.soundBank.destroySoundBank();
        }
        this.soundBankList = [];
    }

    private generatePresetList() {
        const presetList = new Array<SoundBankManagerPreset>();

        const addedPresets = new Set<string>();
        for (const s of this.soundBankList) {
            const bank = s.soundBank;
            const bankOffset = s.bankOffset;
            for (const p of bank.presets) {
                const selectablePreset = new SoundBankManagerPreset(
                    p,
                    bankOffset
                );
                if (!addedPresets.has(selectablePreset.toMIDIString())) {
                    addedPresets.add(selectablePreset.toMIDIString());
                    presetList.push(selectablePreset);
                }
            }
        }
        presetList.sort(MIDIPatchTools.compare.bind(MIDIPatchTools));
        this.selectablePresetList = presetList;
        this._presetList = presetList.map((p) => {
            return {
                bankMSB: p.bankMSB,
                bankLSB: p.bankLSB,
                program: p.program,
                isGMGSDrum: p.isGMGSDrum,
                name: p.name,
                isDrum: p.isDrum
            };
        });
        this.presetListChangeCallback();
    }
}
