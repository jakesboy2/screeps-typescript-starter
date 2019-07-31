import {
    GROUPED,
    ROOM_STATE_INTRO,
    ROOM_STATE_BEGINNER,
    ROOM_STATE_INTER,
    ROOM_STATE_ADVANCED,
    ROOM_STATE_NUKE_INBOUND,
    ROOM_STATE_STIMULATE,
    ROOM_STATE_UPGRADER,
    TIER_2,
    TIER_3,
    TIER_4,
    TIER_5,
    TIER_6,
    TIER_7,
    TIER_8,
    ROLE_CLAIMER,
} from "utils/Constants";
import { SpawnHelper } from "Helpers/SpawnHelper";
import SpawnApi from "Api/Spawn.Api"

export class ClaimerBodyOptsHelper implements ICreepBodyOptsHelper {

    public name: RoleConstant = ROLE_CLAIMER;

    constructor() {
        const self = this;
        self.generateCreepBody = self.generateCreepBody.bind(self);
        self.generateCreepOptions = self.generateCreepOptions.bind(this);
    }

    /**
     * Generate body for claimer creep
     * @param roomState the room state for the room
     */
    public generateCreepOptions(roomState: RoomStateConstant): CreepOptionsCiv | undefined {
        let creepOptions: CreepOptionsCiv = SpawnHelper.getDefaultCreepOptionsCiv();

        switch (roomState) {
            case ROOM_STATE_INTRO:
            case ROOM_STATE_BEGINNER:
            case ROOM_STATE_INTER:
            case ROOM_STATE_ADVANCED:
            case ROOM_STATE_STIMULATE:
            case ROOM_STATE_UPGRADER:
            case ROOM_STATE_NUKE_INBOUND:
                creepOptions = {};

                break;
        }

        return creepOptions;
    }

    /**
     * Generate options for claimer creep
     * @param tier the tier of the room
     */
    public generateCreepBody(tier: TierConstant): BodyPartConstant[] {
        // Default Values for Claimer
        let body: CreepBodyDescriptor = { claim: 1, move: 2 };
        const opts: CreepBodyOptions = { mixType: GROUPED };

        switch (tier) {
            case TIER_8:
            case TIER_7:
            case TIER_6:
            case TIER_5:
            case TIER_4:
            case TIER_3:
            case TIER_2: // 1 Claim, 2 Move, Total Cost: 400
                body = { claim: 1, move: 2 };
                break;
        }

        // Generate creep body based on body array and options
        return SpawnApi.createCreepBody(body, opts);
    }
}