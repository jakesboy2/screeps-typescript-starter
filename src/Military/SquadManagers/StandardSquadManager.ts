import {
    STANDARD_MAN,
    SpawnApi,
    ROLE_MEDIC,
    ROLE_ZEALOT,
    LOW_PRIORITY,
    MemoryApi_Military,
    SQUAD_STATUS_OK,
    OP_STRATEGY_COMBINED,
    OP_STRATEGY_FFA,
    MilitaryMovement_Api,
    SQUAD_STATUS_RALLY,
    SQUAD_STATUS_DONE,
    SQUAD_STATUS_DEAD,
    MilitaryCombat_Api,
    militaryDataHelper,
} from "Utils/Imports/internals";
import { MilitaryStatus_Helper } from "Military/Military.Status.Helper";
import { MilitaryIntents_Api } from "Military/Military.Api.Intents";
import _ from "lodash";
import { MilitaryMovement_Helper } from "Military/Military.Movement.Helper";

export class StandardSquadManager implements ISquadManager {
    public name: SquadManagerConstant = STANDARD_MAN;
    public creeps: SquadStack[] = [];
    public targetRoom: string = "";
    public squadUUID: string = "";
    public operationUUID: string = "";
    public initialRallyComplete: boolean = false;
    public rallyPos: MockRoomPos | undefined;
    public orientation: DirectionConstant | undefined;
    public attackTarget: Id<Creep | Structure> | undefined;

    constructor() {
        const self = this;
        self.runSquad = self.runSquad.bind(this);
        self.createInstance = self.createInstance.bind(this);
        self.getSquadArray = self.getSquadArray.bind(this);
        self.checkStatus = self.checkStatus.bind(this);
        self.addCreep = self.addCreep.bind(this);
        self.creeps = [];
    }

    /**
     * Run the squad manager
     * @param instance the speecific instance of the squad we're running
     */
    public runSquad(instance: ISquadManager): void {
        const operation = MemoryApi_Military.getOperationByUUID(instance.operationUUID);
        const squadImplementation = this.getSquadStrategyImplementation(operation!);

        // Run the specific strategy for the current operation
        squadImplementation.runSquad(instance);
    }

    /**
     * Returns the implementation object for the squad
     * @param operation The parent operation of the squad
     */
    public getSquadStrategyImplementation(operation: MilitaryOperation): SquadStrategyImplementation {
        switch (operation.operationStrategy) {
            case OP_STRATEGY_COMBINED:
                return this[OP_STRATEGY_COMBINED];
            case OP_STRATEGY_FFA:
                return this[OP_STRATEGY_FFA];
            default:
                return this[OP_STRATEGY_FFA];
        }
    }

    /**
     * Create an instance and place into the empire memory
     * @param targetRoom the room we are attacking
     */
    public createInstance(targetRoom: string, operationUUID: string): StandardSquadManager {
        const uuid: string = SpawnApi.generateSquadUUID(operationUUID);
        const instance = new StandardSquadManager();
        instance.squadUUID = uuid;
        instance.targetRoom = targetRoom;
        instance.operationUUID = operationUUID;
        instance.initialRallyComplete = false;
        instance.rallyPos = undefined;
        instance.orientation = undefined;
        instance.attackTarget = undefined;
        return instance;
    }

    /**
     * Add a creep to the class
     * @param creep the creep we are adding to the squad
     * @param instance the speecific instance of the squad we're running
     */
    public addCreep(instance: ISquadManager, creepName: string): void {
        MemoryApi_Military.addCreepToSquad(instance.operationUUID, instance.squadUUID, creepName);
    }

    /**
     * Check the status of the squad
     * @param instance the speecific instance of the squad we're running
     * @returns boolean representing the squads current status
     */
    public checkStatus(instance: ISquadManager): SquadStatusConstant {
        // Handle initial rally status
        if (!instance.initialRallyComplete) {
            if (MilitaryMovement_Api.isQuadSquadInRallyPos(instance)) {
                instance.initialRallyComplete = true;
                return SQUAD_STATUS_OK;
            }
            return SQUAD_STATUS_RALLY;
        }

        // Check if the squad is done with the attack (ie, attack success)
        if (MilitaryCombat_Api.isOperationDone(instance)) {
            return SQUAD_STATUS_DONE;
        }

        // Check if the squad was killed
        if (MilitaryCombat_Api.isSquadDead(instance)) {
            return SQUAD_STATUS_DEAD;
        }

        // If nothing else, we are OK
        return SQUAD_STATUS_OK;
    }

    /**
     * Gets the members of the squad in array form
     * @returns array containing all squad member's role constants
     */
    public getSquadArray(): SquadDefinition[] {
        const zealot1: SquadDefinition = {
            role: ROLE_ZEALOT,
            caravanPos: 0
        };
        const zealot2: SquadDefinition = {
            role: ROLE_ZEALOT,
            caravanPos: 1
        };
        const medic1: SquadDefinition = {
            role: ROLE_MEDIC,
            caravanPos: 2
        };
        const medic2: SquadDefinition = {
            role: ROLE_MEDIC,
            caravanPos: 3
        };
        return [zealot1, zealot2, medic1, medic2];
    }

    /**
     * Get the spawn priority of the military squad
     */
    public getSpawnPriority(): number {
        return LOW_PRIORITY;
    }

    /**
     * Implementation of OP_STRATEGY_FFA
     */
    public ffa = {
        runSquad(instance: ISquadManager): void {
            const singleton: ISquadManager = MemoryApi_Military.getSingletonSquadManager(instance.name);
            const status: SquadStatusConstant = singleton.checkStatus(instance);

            if (MilitaryStatus_Helper.handleSquadDeadStatus(status, instance)) {
                return;
            }
            MilitaryStatus_Helper.handleNotOKStatus(status);

            const dataNeeded: MilitaryDataParams = {
                hostiles: true,
                hostileStructures: true
            };
            const creeps: Creep[] = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);
            const roomData: MilitaryDataAll = militaryDataHelper.getRoomData(creeps, {}, dataNeeded, instance);

            if (status !== SQUAD_STATUS_RALLY) {
                if (!instance.attackTarget || MilitaryMovement_Helper.needSwitchAttackTarget(instance, roomData, instance.attackTarget)) {
                    const attackTarget: Structure | Creep | undefined = MilitaryCombat_Api.getSeigeAttackTarget(instance, roomData);
                    instance.attackTarget = attackTarget ? attackTarget.id : undefined;
                }
            }

            MilitaryIntents_Api.resetSquadIntents(instance);
            this.decideMoveIntents(instance, status, roomData);
            this.decideAttackIntents(instance, status, roomData);
            this.decideHealIntents(instance, status, roomData);

            for (const i in creeps) {
                const creep: Creep = creeps[i];
                MilitaryCombat_Api.runIntents(instance, creep, roomData);
            }
        },

        decideMoveIntents(instance: ISquadManager, status: SquadStatusConstant, roomData: MilitaryDataAll): void {
            const creeps = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);

            _.forEach(creeps, (creep: Creep) => {
                // Try to get off exit tile first, then get a move target based on what room we're in
                if (MilitaryIntents_Api.queueIntentMoveOffExitTile(creep, instance)) {
                    return;
                }

                if (MilitaryIntents_Api.queueIntentMoveQuadSquadRallyPos(creep, instance, status)) {
                    return;
                }
            });

            // At this point, squad is finished rallying and moves as a unit at all times
            // Only one path is required and all creeps will queue the same intent
            if (status === SQUAD_STATUS_RALLY) {
                return;
            }

            // Move into target room
            if (MilitaryIntents_Api.queueIntentsMoveQuadSquadIntoTargetRoom(instance)) {
                // Once we're moving into the target room reset the move path to work off a clean slate
                _.forEach(creeps, (creep: Creep) => militaryDataHelper.movePath[instance.squadUUID][creep.name] = []);
                militaryDataHelper.movePath[instance.squadUUID][instance.targetRoom] = [];
                return;
            }

            // In target room, move towards attack target
            if (MilitaryIntents_Api.queueIntentsQuadSquadFixOrientation(instance)) {
                return;
            }

            if (MilitaryIntents_Api.queueIntentsMoveQuadSquadTowardsAttackTarget(instance)) {
                return;
            }
        },

        decideAttackIntents(instance: ISquadManager, status: SquadStatusConstant, roomData: MilitaryDataAll) {
            const creeps = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);
            if (roomData[instance.targetRoom] === undefined) {
                return;
            }

            const zealots: Creep[] = _.filter(creeps, (creep: Creep) => creep.memory.role === ROLE_ZEALOT);
            _.forEach(zealots, (creep: Creep) => {
                if (!instance.attackTarget) return;
                MilitaryIntents_Api.queueIntentMeleeAttackSquadTarget(creep, instance);
            });
        },

        decideHealIntents(instance: ISquadManager, status: SquadStatusConstant, roomData: MilitaryDataAll): void {
            const creeps = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);
            if (roomData[instance.targetRoom] === undefined) {
                return;
            }

            const healTarget: Creep | undefined = MilitaryCombat_Api.getHealTarget(instance);

            const healers: Creep[] = _.filter(creeps, (creep: Creep) => creep.memory.role === ROLE_MEDIC);
            _.forEach(healers, (creep: Creep) => {
                if (!healTarget) {
                    MilitaryIntents_Api.queueHealSelfIntentSquad(creep, instance, roomData);
                }
                else {
                    MilitaryIntents_Api.queueHealAllyCreep(creep, instance, healTarget, roomData);
                }
            });
        }
    };

    /**
     * Implementation of OP_STRATEGY_COMBINED
     */
    public combined = {
        runSquad(instance: ISquadManager): void {
            return;
        }
    };
}
