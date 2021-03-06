import {
    MemoryApi_Military,
    MilitaryCombat_Api,
    MilitaryMovement_Api,
    ACTION_MOVE,
    ACTION_RANGED_ATTACK,
    ACTION_HEAL,
    Normalize,
    UserException,
    ERROR_ERROR,
    SQUAD_STATUS_RALLY,
    militaryDataHelper,
    RoomHelper_Structure, ACTION_ATTACK, MilitaryIntents_Helper
} from "Utils/Imports/internals";
import { MilitaryMovement_Helper } from "./Military.Movement.Helper";
import _ from "lodash";
import { CostMatrixApi } from "Pathfinding/CostMatrix.Api";

export class MilitaryIntents_Api {
    /**
     * Reset the intents for the squad
     * @param instance the squad instance we are referring to
     */
    public static resetSquadIntents(instance: ISquadManager): void {
        const creeps = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);

        _.forEach(creeps, (creep: Creep) => {
            const creepStack = MemoryApi_Military.findCreepInSquadByInstance(instance, creep.name);

            if (creepStack === undefined) {
                return;
            }

            creepStack.intents = [];
        });
    }

    /**
     * Queue the intent to move the creep to their rally position
     * @param creep The creep we're queueing the intent for
     * @param instance the instance we're currently inside
     */
    public static queueIntentsMoveToRallyPos(
        creep: Creep,
        instance: ISquadManager,
        status: SquadStatusConstant
    ): boolean {
        if (!instance.rallyPos || status !== SQUAD_STATUS_RALLY) {
            return false;
        }

        const options: CreepOptionsMili = creep.memory.options as CreepOptionsMili;
        if (options.caravanPos === null || options.caravanPos === undefined) {
            return false;
        }
        const rallyPos: RoomPosition = Normalize.convertMockToRealPos(instance.rallyPos);
        const path: PathStep = creep.pos.findPathTo(rallyPos, { range: options.caravanPos })[0];
        if (!path) {
            return true;
        }
        const direction: DirectionConstant = path.direction;
        const intent: Move_MiliIntent = {
            action: ACTION_MOVE,
            target: direction,
            targetType: "direction"
        };

        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * Move the squad into their rally positions for quad squad
     * @param creep the creep we're currently controlling
     * @param instance the instance we're controlling
     * @param status the status of the squad
     * @returns boolean representing if we queued an intent
     */
    public static queueIntentMoveQuadSquadRallyPos(
        creep: Creep,
        instance: ISquadManager,
        status: SquadStatusConstant
    ): boolean {
        if (!instance.rallyPos || status !== SQUAD_STATUS_RALLY) {
            return false;
        }
        const options: CreepOptionsMili = creep.memory.options as CreepOptionsMili;
        if (options.caravanPos === null || options.caravanPos === undefined) {
            return false;
        }

        const currPos: RoomPosition = Normalize.convertMockToRealPos(instance.rallyPos);
        const exit = Game.map.findExit(currPos.roomName, instance.targetRoom);
        if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
            throw new UserException("No path or invalid args for queueIntentMoveQuadSquadRallyPos", "rip", ERROR_ERROR);
        }

        const posArr: RoomPosition[] = MilitaryMovement_Helper.getQuadSquadRallyPosArray(currPos, exit);
        const target: RoomPosition = posArr[options.caravanPos];
        let movePath: PathStep[] = militaryDataHelper.getMovePath(instance, creep.name);

        // Handles the case of creep getting path blocked at some point
        // TODO add stuck detection
        if (MilitaryMovement_Api.verifyPathTarget(movePath, target) === false || RoomHelper_Structure.executeEveryTicks(10)) {
            movePath = creep.pos.findPathTo(posArr[options.caravanPos]);
            militaryDataHelper.movePath[instance.squadUUID][creep.name] = movePath;
        }

        const nextStepIndex: number = MilitaryMovement_Api.nextPathStep(creep.pos, movePath);
        if (nextStepIndex === -1) {
            return true;
        }

        const direction: DirectionConstant = movePath[nextStepIndex].direction;
        const intent: Move_MiliIntent = {
            action: ACTION_MOVE,
            target: direction,
            targetType: "direction"
        };

        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * Queue an intent to move off the exit tile
     * @param creep
     * @param instance the squad the creep is apart of
     * @returns boolean representing if we queued the intent
     */
    public static queueIntentMoveOffExitTile(creep: Creep, instance: ISquadManager): boolean {
        const directionOffExitTile: DirectionConstant | undefined = MilitaryMovement_Api.getDirectionOffExitTile(creep);
        if (!directionOffExitTile) {
            return false;
        }

        // TODO Look at the target tile to see if it occupied, if so try adding/subtracting 1 to the direction to offset and check again
        const intent: Move_MiliIntent = {
            action: ACTION_MOVE,
            target: directionOffExitTile,
            targetType: "direction"
        };

        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * Queue intents to get to the target room
     * @param creep the creep we're controlling
     * @param instance the instance that the creep is in
     * @returns boolean representing if we queued an intent
     */
    public static queueIntentMoveToTargetRoom(creep: Creep, instance: ISquadManager): boolean {
        if (creep.room.name === instance.targetRoom) {
            return false;
        }

        const target = new RoomPosition(25, 25, instance.targetRoom);
        let movePath = militaryDataHelper.getMovePath(instance, creep.name);

        if (!MilitaryMovement_Api.verifyPathTarget(movePath, target)) {
            movePath = creep.pos.findPathTo(target, { range: 25 });
        }

        const moveIndex: number = MilitaryMovement_Api.nextPathStep(creep.pos, movePath);

        if (moveIndex === -1) {
            return false;
        }
        const directionToTarget = movePath[moveIndex].direction;
        const intent: Move_MiliIntent = {
            action: ACTION_MOVE,
            target: directionToTarget,
            targetType: "direction"
        };

        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * Queue the kiting intent for an enemy creep
     * @param creep the creep we're queueing the intent for
     * @param targetHostile the hostile we want to kite
     * @param instance the squad instance we're controlling
     * @returns boolean representing if we queued an intent
     */
    public static queueIntentMoveTargetKiting(
        creep: Creep,
        targetHostile: Creep | undefined,
        instance: ISquadManager
    ): boolean {
        if (targetHostile) {
            let directionToTarget: DirectionConstant | undefined;

            if (MilitaryCombat_Api.isInAttackRange(creep, targetHostile.pos, false)) {
                directionToTarget = MilitaryCombat_Api.getKitingDirection(creep, targetHostile);

                if (!directionToTarget) {
                    return false;
                }
            } else {
                const path = creep.pos.findPathTo(targetHostile.pos, { range: 3 });
                directionToTarget = path[0].direction;
            }

            const intent: Move_MiliIntent = {
                action: ACTION_MOVE,
                target: directionToTarget,
                targetType: "direction"
            };

            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    /**
     * Kite an enemy next to us
     * @param creep the creep we're controlling
     */
    public static queueIntentMoveNearHostileKiting(creep: Creep, instance: ISquadManager, hostiles: Creep[]): boolean {
        const closeEnemy: Creep | null = creep.pos.findClosestByPath(hostiles);
        if (closeEnemy && MilitaryCombat_Api.isInAttackRange(creep, closeEnemy.pos, false)) {
            const directionToTarget = MilitaryCombat_Api.getKitingDirection(creep, closeEnemy);
            if (!directionToTarget) {
                return false;
            }
            const intent: Move_MiliIntent = {
                action: ACTION_MOVE,
                target: directionToTarget,
                targetType: "direction"
            };

            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    /**
     * Queue ranged attack intent for the ideal target
     * @param creep the creep we're controlling
     * @param instance the instance the creep is apart of
     * @returns boolean representing if we queued the intent
     */
    public static queueRangedAttackIntentBestTarget(
        creep: Creep,
        instance: ISquadManager,
        hostiles: Creep[] | undefined,
        creeps: Creep[]
    ): boolean {
        const bestTargetHostile: Creep | undefined = MilitaryCombat_Api.getRemoteDefenderAttackTarget(
            hostiles,
            creeps,
            instance.targetRoom
        );
        if (!bestTargetHostile) {
            return false;
        }

        if (creep.pos.inRangeTo(bestTargetHostile.pos, 3)) {
            const intent: RangedAttack_MiliIntent = {
                action: ACTION_RANGED_ATTACK,
                target: bestTargetHostile.id,
                targetType: "creepID"
            };

            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    /**
     * Queue intent for an alternative target that isn't the ideal one
     * @param creep the creep we're controlling
     * @param instance the instance the creep is apart of
     * @param roomData the roomData for the operation
     * @returns boolean representing if we queued the intent
     */
    public static queueRangedAttackIntentAlternateClosestTarget(
        creep: Creep,
        instance: ISquadManager,
        roomData: MilitaryDataAll
    ): boolean {
        // Find any other attackable creep if we can't hit the best target
        const closestHostileCreep: Creep | undefined = _.find(
            roomData[instance.targetRoom].hostiles!.allHostiles,
            (hostile: Creep) => hostile.pos.getRangeTo(creep.pos) <= 3
        );

        if (closestHostileCreep !== undefined) {
            const intent: RangedAttack_MiliIntent = {
                action: ACTION_RANGED_ATTACK,
                target: closestHostileCreep.id,
                targetType: "creepID"
            };

            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    /**
     * Queue intent for healing ourselves
     * @param creep the creep we're controlling
     * @param instance the instance the creep is apart of
     * @param roomData the roomData for the operation
     * @returns boolean representing if we queued the intent
     */
    public static queueHealSelfIntentDefender(creep: Creep, instance: ISquadManager, roomData: MilitaryDataAll): boolean {
        // Heal if we are below full, preheal if theres hostiles and we aren't under a rampart
        const creepIsOnRampart: boolean =
            _.filter(
                creep.pos.lookFor(LOOK_STRUCTURES),
                (struct: Structure) => struct.structureType === STRUCTURE_RAMPART
            ).length > 0;
        if (
            (roomData[instance.targetRoom].hostiles!.allHostiles.length > 0 && !creepIsOnRampart) ||
            creep.hits < creep.hitsMax
        ) {
            const intent: Heal_MiliIntent = {
                action: ACTION_HEAL,
                target: creep.name,
                targetType: "creepName"
            };

            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    public static queueHealSelfIntentSquad(creep: Creep, instance: ISquadManager, roomData: MilitaryDataAll): boolean {
        const intent: Heal_MiliIntent = {
            action: ACTION_HEAL,
            target: creep.name,
            targetType: "creepName"
        };

        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * TODO
     * Queue intent for healing friendly creeps
     * @param creep the creep we're controlling
     * @param instance the instance the creep is apart of
     * @param roomData the roomData for the operation
     * @returns boolean representing if we queued the intent
     */
    public static queueHealAllyCreep(creep: Creep, instance: ISquadManager, targetCreep: Creep, roomData: MilitaryDataAll): boolean {
        const intent: Heal_MiliIntent = {
            action: ACTION_HEAL,
            target: targetCreep.name,
            targetType: "creepName"
        };
        MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        return true;
    }

    /**
     * Queue the intents for all creeps in the squad to move them from the rally pos into the target room
     * TODO Currently only works for moving into target room from the room directly before
     * @param instance
     * @returns boolean representing if we queued the intents
     */
    public static queueIntentsMoveQuadSquadIntoTargetRoom(instance: ISquadManager): boolean {
        if (!instance.orientation) {
            if (!instance.rallyPos) throw new UserException("No rally position", "Squad - " + instance.squadUUID, ERROR_ERROR);
            const currPos: RoomPosition = Normalize.convertMockToRealPos(instance.rallyPos);
            const exit = Game.map.findExit(currPos.roomName, instance.targetRoom);
            if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
                throw new UserException("No path or invalid args for queueIntentMoveQuadSquadRallyPos", "rip", ERROR_ERROR);
            }
            instance.orientation = MilitaryMovement_Helper.getInitialSquadOrientation(instance, exit);
        }

        // If lead creep is in target room and 2 tiles from exit, we do not need to move squad into target room
        if (MilitaryMovement_Helper.isLeadCreepInTargetRoom(instance)) {
            return false;
        }

        const creeps: Creep[] = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);
        if (_.some(creeps, (creep) => creep.fatigue > 0)) return true;
        _.forEach(creeps, (creep: Creep) => {
            const intent: Move_MiliIntent = {
                action: ACTION_MOVE,
                target: instance.orientation!,
                targetType: "direction"
            };
            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        });
        return true;
    }

    /**
     * Queue the intent to attack the squad target for a melee creep
     * @param creep the creep we are currently queueing the intent for
     * @param instance the instance we are currently controlling
     */
    public static queueIntentMeleeAttackSquadTarget(creep: Creep, instance: ISquadManager): boolean {
        if (!instance.attackTarget) return false;
        const attackTarget: Creep | Structure | null = Game.getObjectById(instance.attackTarget);
        if (!attackTarget) return false;
        if (MilitaryCombat_Api.isInAttackRange(creep, attackTarget.pos, true)) {
            // Revisit need for target type at all, for now default to creep/structure (no difference in behavior)
            const intent: Attack_MiliIntent = {
                action: ACTION_ATTACK,
                target: instance.attackTarget,
                targetType: "structure"
            }
            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
            return true;
        }
        return false;
    }

    /**
     * Queue the intents needed to fix the orientation of the quad squad
     * @param instance the instance we are controlling
     * @returns boolean representing if we had to reorient the squad
     */
    public static queueIntentsQuadSquadFixOrientation(instance: ISquadManager): boolean {
        const currentOrientation: DirectionConstant | undefined = instance.orientation;
        if (!currentOrientation) throw new UserException("No orientation for squad", "Squad - " + instance.squadUUID, ERROR_ERROR);

        // Get the direction that we are going for the next step
        const topLeftCreep: Creep = MemoryApi_Military.findTopLeftCreep(instance);
        const movePath: PathStep[] = militaryDataHelper.getMovePath(instance, instance.targetRoom)
        if (movePath.length === 0) return false;
        const moveIndex: number = MilitaryMovement_Api.nextPathStep(topLeftCreep.pos, movePath);
        if (moveIndex === -1) {
            return false;
        }
        const nextStepDirection: DirectionConstant = movePath[moveIndex].direction;
        if (!MilitaryMovement_Helper.isOrientationChangeRequired(currentOrientation, nextStepDirection)) return false;

        // Change orientation based on current orientation and desired orientation
        let clockWiseRotations: DirectionConstant[] = [];
        let counterClockwiseRotations: DirectionConstant[] = [];
        let turnAroundRotations: DirectionConstant[] = [];
        switch (currentOrientation) {
            case LEFT:
                clockWiseRotations = [TOP, TOP_RIGHT];
                counterClockwiseRotations = [BOTTOM, BOTTOM_RIGHT];
                turnAroundRotations = [RIGHT];
                break;

            case RIGHT:
                clockWiseRotations = [BOTTOM, BOTTOM_LEFT];
                counterClockwiseRotations = [TOP, TOP_LEFT];
                turnAroundRotations = [LEFT];
                break;

            case TOP:
                clockWiseRotations = [RIGHT, BOTTOM_RIGHT];
                counterClockwiseRotations = [LEFT, BOTTOM_LEFT];
                turnAroundRotations = [BOTTOM];
                break;

            case BOTTOM:
                clockWiseRotations = [LEFT, TOP_LEFT];
                counterClockwiseRotations = [RIGHT, TOP_RIGHT];
                turnAroundRotations = [TOP];
                break;
            default:
                throw new UserException("Invalid orientation - " + currentOrientation, "Squad - " + instance.squadUUID, ERROR_ERROR);
        }

        // Apply the correct operation to reorient the squad
        if (turnAroundRotations.includes(nextStepDirection)) {
            MilitaryIntents_Helper.queueIntentsQuadSquadTurnAround(instance, currentOrientation);
            instance.orientation = MilitaryIntents_Helper.updateSquadOrientation(currentOrientation, "turnAround");
        }
        else if (clockWiseRotations.includes(nextStepDirection)) {
            MilitaryIntents_Helper.queueIntentsQuadSquadRotateClockwise(instance, currentOrientation);
            instance.orientation = MilitaryIntents_Helper.updateSquadOrientation(currentOrientation, "clockwise");
        }
        else if (counterClockwiseRotations.includes(nextStepDirection)) {
            MilitaryIntents_Helper.queueIntentsQuadSquadRotateCounterClockwise(instance, currentOrientation);
            instance.orientation = MilitaryIntents_Helper.updateSquadOrientation(currentOrientation, "counterClockwise");
        }
        else {
            throw new UserException("Could not reorient squad, incorrect mapping", "Squad - " + instance.squadUUID, ERROR_ERROR);
        }
        return true;
    }

    /**
     * Queue the intents needed to move the quad squad towards their attack target
     * @param instance the instance we are controller
     * @returns boolean representing if we moved towards the attack target successfully
     */
    public static queueIntentsMoveQuadSquadTowardsAttackTarget(instance: ISquadManager): boolean {
        if (!instance.attackTarget) return false;
        const attackTarget: Creep | Structure | null = Game.getObjectById(instance.attackTarget);
        if (!attackTarget) return false;
        const leadCreep: Creep = MemoryApi_Military.getLeadSquadCreep(instance);
        // No need to move if we are in attack range
        if (MilitaryCombat_Api.isInAttackRange(leadCreep, attackTarget.pos, true)) return false;

        // Since the move path is squad based off static location in the squad, use targetRoom as secondary lookup value
        let movePath = militaryDataHelper.getMovePath(instance, instance.targetRoom);
        const pathingPoint: RoomPosition = MilitaryMovement_Helper.getQuadSquadPathingPoint(instance);
        const topLeftCreep: Creep = MemoryApi_Military.findTopLeftCreep(instance);
        if (MilitaryMovement_Api.verifyPathTarget(movePath, attackTarget.pos) === false) {
            movePath = pathingPoint.findPathTo(attackTarget.pos, {
                costCallback(roomName, costMatrix) {
                    return CostMatrixApi.getQuadSquadMatrix(instance.targetRoom, TOP);
                }
            });
            militaryDataHelper.movePath[instance.squadUUID][instance.targetRoom] = movePath;
        }

        const nextStepIndex: number = MilitaryMovement_Api.nextPathStep(topLeftCreep.pos, movePath);
        if (nextStepIndex === -1) {
            return false;
        }

        const directionToTarget = movePath[nextStepIndex].direction;
        const creeps: Creep[] = MemoryApi_Military.getLivingCreepsInSquadByInstance(instance);
        const creepHasFatigue: boolean = _.some(creeps, (creep: Creep) => creep.fatigue > 0);

        // Prevent intents until all creeps have no fatigue
        if (creepHasFatigue) {
            return true;
        }

        _.forEach(creeps, (creep: Creep) => {
            const intent: Move_MiliIntent = {
                action: ACTION_MOVE,
                target: directionToTarget,
                targetType: "direction"
            };
            MemoryApi_Military.pushIntentToCreepStack(instance, creep.name, intent);
        });

        return true;
    }
}
