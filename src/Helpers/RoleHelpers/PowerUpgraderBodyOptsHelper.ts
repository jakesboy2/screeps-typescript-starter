import {
    GROUPED,
    ROOM_STATE_NUKE_INBOUND,
    ROOM_STATE_STIMULATE,
    ROOM_STATE_UPGRADER,
    TIER_6,
    TIER_7,
    TIER_8,
    ROLE_POWER_UPGRADER,
} from "utils/Constants";
import { SpawnHelper } from "Helpers/SpawnHelper";
import SpawnApi from "Api/Spawn.Api"

export class PowerUpgraderBodyOptsHelper implements ICreepBodyOptsHelper {

    public name: RoleConstant = ROLE_POWER_UPGRADER;

    constructor() {
        const self = this;
        self.generateCreepBody = self.generateCreepBody.bind(self);
        self.generateCreepOptions = self.generateCreepOptions.bind(this);
    }

    /**
     * Generate body for power upgrader creep
     * @param tier the tier of the room
     */
    public generateCreepBody(tier: TierConstant): BodyPartConstant[] {
        // Default Values for Power Upgrader
        let body: CreepBodyDescriptor = { work: 18, carry: 8, move: 4 };
        const opts: CreepBodyOptions = { mixType: GROUPED };

        // There are currently no plans to use power upgraders before links become available
        // Need to experiment with work parts here and find out whats keeps up with the links
        // Without over draining the storage, but still puts up numbers
        switch (tier) {
            case TIER_6: // 15 Work, 1 Carry, 1 Move - Total Cost: 2300
                body = { work: 17, carry: 8, move: 4 };
                break;

            case TIER_7: // 1 Work, 8 Carry, 4 Move - Total Cost: 2800
                body = { work: 22, carry: 8, move: 4 };
                break;

            case TIER_8: // 1 Work, 8 Carry, 4 Move - Total Cost: 2100
                body = { work: 15, carry: 8, move: 4 }; // RCL 8 you can only do 15 per tick
                break;
        }

        // Generate creep body based on body array and options
        return SpawnApi.createCreepBody(body, opts);
    }

    /**
     * Generate options for power upgrader creep
     * @param roomState the room state of the room
     */
    public generateCreepOptions(roomState: RoomStateConstant): CreepOptionsCiv | undefined {
        let creepOptions: CreepOptionsCiv = SpawnHelper.getDefaultCreepOptionsCiv();

        switch (roomState) {
            case ROOM_STATE_UPGRADER:
            case ROOM_STATE_STIMULATE:
            case ROOM_STATE_NUKE_INBOUND:
                creepOptions = {
                    upgrade: true, //
                    getFromLink: true //
                };

                break;
        }

        return creepOptions;
    }
}