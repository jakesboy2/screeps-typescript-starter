import {
    PathfindingApi,
    RoomHelper_State,
    ROOM_STATUS_SOURCE_KEEPER,
    ROOM_STATUS_HIGHWAY,
    ROOM_STATUS_ALLY,
    ROOM_STATUS_HOSTILE,
    ROOM_STATUS_INVADER_REMOTE,
    ROOM_STATUS_HOSTILE_REMOTE,
    ROOM_STATUS_NEUTRAL,
    ROOM_STATUS_ALLY_REMOTE,
    RoomManager,
    ROOM_STATUS_UNKNOWN,
    ACTION_MOVE
} from "Utils/Imports/internals";
import { CostMatrixApi } from "./CostMatrix.Api";

export class Voyager {
    public static voyageTo(
        creep: Creep,
        destination: _HasRoomPosition | RoomPosition | null,
        options: VoyageToOptions = {}
    ): number {
        Voyager.updateRoomStatus(creep.room);

        if (creep.fatigue > 0) {
            if (options.enableVisuals !== false) {
                Voyager.circle(creep.pos, "aqua", 0.3);
            }
            return ERR_TIRED;
        }

        if(!destination) {
            return ERR_INVALID_TARGET;
        }

        destination = Voyager.normalizePos(destination);

        // Manage case where creep is nearby destination
        const rangeToDestination: number = creep.pos.getRangeTo(destination);
        if (options.range && rangeToDestination <= options.range) {
            return OK;
        } else if (rangeToDestination <= 1) {
            if (rangeToDestination === 1 && !options.range) {
                const direction = creep.pos.getDirectionTo(destination);
                if (options.returnData) {
                    options.returnData.nextPos = destination;
                    options.returnData.path = direction.toString();
                }

                // Return without moving if returnIntent is passed
                if (options.returnIntent) {
                    options.returnIntent = {
                        action: ACTION_MOVE,
                        target: direction,
                        targetType: "direction"
                    };
                    return OK;
                }

                return creep.move(direction);
            }
            return OK;
        }

        // initialize movement data object
        if (!creep.memory._voyage) {
            creep.memory._voyage = { state: { cpu: 0, destination }, path: "" };
        }

        const voyageData: VoyagerData = creep.memory._voyage;
        const voyageState: VoyageState = voyageData.state;

        if (options.enableVisuals !== false) {
            Voyager.circle(destination, "orange");
        }

        // check if creep is stuck
        if (this.isStuck(creep, voyageState)) {
            voyageState.stuckCount = voyageState.stuckCount ? voyageState.stuckCount++ : 1;
            Voyager.circle(creep.pos, "magenta", voyageState.stuckCount * 0.2);
        } else {
            voyageState.stuckCount = 0;
        }

        // handle case where creep is stuck
        if (!options.stuckValue) {
            options.stuckValue = DEFAULT_STUCK_VALUE;
        }
        if (voyageState.stuckCount >= options.stuckValue && Math.random() > 0.5) {
            options.costMatrices = options.costMatrices?.concat(["ownedCreepMatrix", "nonOwnedCreepMatrix"])
            delete voyageData.path;
        }

        // TODO Handle returning to position when force-swapped by another creep

        // delete path cache if destination is different
        if (!this.isSamePos(voyageState.destination, destination)) {
            if (options.movingTarget && voyageState.destination.isNearTo(destination)) {
                voyageData.path += voyageState.destination.getDirectionTo(destination);
                voyageState.destination = destination;
            } else {
                delete voyageData.path;
            }
        }

        // Randomly repath
        if (options.repath && Math.random() < options.repath) {
            // add some chance that you will find a new path randomly
            delete voyageData.path;
        }

        // pathfinding
        let newPath = false;
        if (!voyageData.path) {
            newPath = true;
            if (creep.spawning) {
                return ERR_BUSY;
            }

            voyageState.destination = destination;

            const cpu = Game.cpu.getUsed();
            const ret = this.findVoyagePath(creep.pos, destination, options);
            const cpuUsed = Game.cpu.getUsed() - cpu;

            voyageState.cpu = _.round(cpuUsed + voyageState.cpu);
            if (voyageState.cpu > REPORT_CPU_THRESHOLD) {
                console.log(
                    `VOYAGER: heavy cpu use: ${creep.name}, cpu: ${voyageState.cpu} origin: ${creep.pos}, dest: ${destination}`
                );
            }

            let color = "orange";
            if (ret.incomplete) {
                console.log(`VOYAGER: incomplete path for ${creep.name}`);
                color = "red";
            }

            if (options.returnData) {
                options.returnData.pathfinderReturn = ret;
            }

            voyageData.path = Voyager.serializePath(creep.pos, ret.path, color);
            voyageState.stuckCount = 0;
        }

        if (!voyageData.path || voyageData.path.length === 0) {
            return ERR_NO_PATH;
        }

        // consume path if we successfully moved last tick
        if (voyageState.stuckCount === 0 && !newPath) {
            voyageData.path = voyageData.path.substr(1);
        }

        const nextDirection = parseInt(voyageData.path[0], 10) as DirectionConstant;
        if (options.returnData) {
            if (nextDirection) {
                const nextPos = Voyager.positionAtDirection(creep.pos, nextDirection);
                if (nextPos) {
                    options.returnData.nextPos = nextPos;
                }
            }
            options.returnData.state = voyageState;
            options.returnData.path = voyageData.path;
        }
        return creep.move(nextDirection);
    }

    /**
     * find a path from origin to destination
     * @param origin
     * @param destination
     * @param options
     * @returns {PathfinderReturn}
     */

    public static findVoyagePath(
        origin: RoomPosition | _HasRoomPosition,
        destination: RoomPosition | _HasRoomPosition,
        options: VoyageToOptions = {}
    ): PathfinderReturn {
        _.defaults(options, {
            maxOps: DEFAULT_MAXOPS,
            allowedRoomStatuses: [ROOM_STATUS_ALLY, ROOM_STATUS_ALLY_REMOTE, ROOM_STATUS_HIGHWAY, ROOM_STATUS_INVADER_REMOTE, ROOM_STATUS_NEUTRAL, ROOM_STATUS_UNKNOWN],
            costMatrices: ["roadTerrainMatrix", "structureMatrix", "ownedCreepMatrix", "nonOwnedCreepMatrix"],
            range: 1
        });

        if (options.movingTarget) {
            options.range = 0;
        }

        origin = this.normalizePos(origin);
        destination = this.normalizePos(destination);

        // check to see whether findRoute should be used
        const roomDistance = Game.map.getRoomLinearDistance(origin.roomName, destination.roomName);
        let allowedRooms = options.route;
        if (!allowedRooms && (options.useFindRoute || (options.useFindRoute === undefined && roomDistance > 2))) {
            // Get rooms that should be used for pathing
            const route = this.findRoute(origin.roomName, destination.roomName, options);
            if (route) {
                allowedRooms = route;
            }
        }

        let roomsSearched = 0;

        const callback = (roomName: string): CostMatrix | boolean => {

            // TODO Handle this differently - why isn't normalizePos doing this already? Likely a scope issue
            destination = destination as RoomPosition;
            origin = origin as RoomPosition;

            if (allowedRooms) {
                if (!allowedRooms[roomName]) {
                    return false;
                }
            } else if (
                Voyager.checkAvoid(roomName, options.allowedRoomStatuses!) &&
                roomName !== destination.roomName  &&
                roomName !== origin.roomName
            ) {
                return false;
            }

            roomsSearched++;

            // Defined either in the options passed in, or by _.defaults
            const matrixTypes: MatrixTypes[] = options.costMatrices!;
            const matrices = _.map(matrixTypes, (type: MatrixTypes) => {
                const matrix = CostMatrixApi.getCostMatrix(type, roomName, options.costMatrixAdditionalparam);
                return matrix === undefined ? new PathFinder.CostMatrix() : matrix;
                });

            let combinedMatrix = CostMatrixApi.sumCostMatrices(matrices);
            combinedMatrix = CostMatrixApi.scaleCostMatrix(combinedMatrix, 1, 100);

            if (options.obstacles) {
                for (const obstacle of options.obstacles) {
                    if (obstacle.pos.roomName !== roomName) {
                        continue;
                    }
                    combinedMatrix.set(obstacle.pos.x, obstacle.pos.y, 0xff);
                }
            }

            if (options.roomCallback) {
                const outcome = options.roomCallback(roomName, combinedMatrix.clone());
                if (outcome !== undefined) {
                    return outcome;
                }
            }

            CostMatrixApi.visualizeCostMatrix(combinedMatrix, roomName);

            return combinedMatrix;
        };

        let ret = PathFinder.search(
            origin,
            { pos: destination, range: options.range! },
            {
                maxOps: options.maxOps,
                maxRooms: options.maxRooms,
                plainCost: options.offRoad ? 1 : options.ignoreRoads ? 1 : 2,
                swampCost: options.offRoad ? 1 : options.ignoreRoads ? 5 : 10,
                roomCallback: callback
            }
        );

        if (ret.incomplete && options.ensurePath) {
            if (options.useFindRoute === undefined) {
                // handle case where pathfinder failed at a short distance due to not using findRoute
                // can happen for situations where the creep would have to take an uncommonly indirect path
                // options.allowedRooms and options.routeCallback can also be used to handle this situation
                if (roomDistance <= 2) {
                    console.log(`TRAVELER: path failed without findroute, trying with options.useFindRoute = true`);
                    console.log(`from: ${origin}, destination: ${destination}`);
                    options.useFindRoute = true;
                    ret = this.findVoyagePath(origin, destination, options);
                    console.log(`TRAVELER: second attempt was ${ret.incomplete ? "not " : ""}successful`);
                    return ret;
                }

                // TODO: handle case where a wall or some other obstacle is blocking the exit assumed by findRoute
            } else {
            }
        }

        return ret;
    }

    /**
     * find a viable sequence of rooms that can be used to narrow down pathfinder's search algorithm
     * @param origin
     * @param destination
     * @param options
     * @returns {{}}
     */

    public static findRoute(
        origin: string,
        destination: string,
        options: VoyageToOptions = {}
    ): { [roomName: string]: boolean } | void {
        const restrictDistance = options.restrictDistance || Game.map.getRoomLinearDistance(origin, destination) + 10;
        const allowedRooms = { [origin]: true, [destination]: true };

        let highwayBias = 1;
        if (options.preferHighway) {
            highwayBias = 2.5;
            if (options.highwayBias) {
                highwayBias = options.highwayBias;
            }
        }

        const ret = Game.map.findRoute(origin, destination, {
            routeCallback: (roomName: string) => {
                if (options.routeCallback) {
                    const outcome = options.routeCallback(roomName);
                    if (outcome !== undefined) {
                        return outcome;
                    }
                }

                const rangeToRoom = Game.map.getRoomLinearDistance(origin, roomName);
                if (rangeToRoom > restrictDistance) {
                    // room is too far out of the way
                    return Number.POSITIVE_INFINITY;
                }

                if (Voyager.checkAvoid(roomName, options.allowedRoomStatuses!) &&
                    roomName !== destination &&
                    roomName !== origin
                ) {
                    // room is marked as "avoid" in room memory
                    return Number.POSITIVE_INFINITY;
                }

                let parsed;
                if (options.preferHighway) {
                    parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName) as any;
                    const isHighway = parsed[1] % 10 === 0 || parsed[2] % 10 === 0;
                    if (isHighway) {
                        return 1;
                    }
                }
                // SK rooms are avoided when there is no vision in the room, harvested-from SK rooms are allowed
                if (_.contains(options.allowedRoomStatuses!, ROOM_STATUS_SOURCE_KEEPER) && !Game.rooms[roomName]) {
                    if (!parsed) {
                        parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName) as any;
                    }
                    const fMod = parsed[1] % 10;
                    const sMod = parsed[2] % 10;
                    const isSK = !(fMod === 5 && sMod === 5) && fMod >= 4 && fMod <= 6 && sMod >= 4 && sMod <= 6;
                    if (isSK) {
                        return 10 * highwayBias;
                    }
                }

                return highwayBias;
            }
        });

        if (!_.isArray(ret)) {
            console.log(`couldn't findRoute to ${destination}`);
            return;
        }
        for (const value of ret) {
            allowedRooms[value.room] = true;
        }

        return allowedRooms;
    }

    /**
     * This is the method that creeps will call to update Memory.empire.movementData
     * @param room The room to update the RoomMovementData for
     */
    private static updateRoomStatus(room: Room): void {
        // Initialize Empire memory if it has not been
        if (!Memory.empire || !Memory.empire.movementData) {
            if (!Memory.empire) {
                Memory.empire = {
                    militaryOperations: {},
                    movementData: {}
                };
            } else if (!Memory.empire.movementData) {
                Memory.empire.movementData = {};
            }
        }

        // Don't check room status if it has been seen this tick
        if (Memory.empire.movementData![room.name] && Memory.empire.movementData![room.name].lastSeen === Game.time) {
            return;
        }

        Memory.empire.movementData![room.name] = {
            roomName: room.name,
            roomStatus: Voyager.checkRoomStatus(room),
            lastSeen: Game.time
        };
    }

    private static checkRoomStatus(room: Room): RoomStatusType {
        if (RoomHelper_State.isNeutralRoom(room)) {
            return ROOM_STATUS_NEUTRAL;
        }

        if (RoomHelper_State.isAllyOwnedRoom(room)) {
            return ROOM_STATUS_ALLY;
        }

        if (RoomHelper_State.isAllyReserved(room)) {
            return ROOM_STATUS_ALLY_REMOTE;
        }

        if (RoomHelper_State.isHighwayRoom(room)) {
            return ROOM_STATUS_HIGHWAY;
        }

        if (RoomHelper_State.isSourceKeeperRoom(room)) {
            return ROOM_STATUS_SOURCE_KEEPER;
        }

        if (RoomHelper_State.isHostileOwnedRoom(room)) {
            return ROOM_STATUS_HOSTILE;
        }

        if (RoomHelper_State.isHostileReserved(room)) {
            return ROOM_STATUS_HOSTILE_REMOTE;
        }

        return ROOM_STATUS_UNKNOWN;
    }

    /**
     * Returns the RoomStatusType, or Unknown if it has not been seen recently. Deletes old movement data
     * @param roomName The room name to check the status of
     */
    private static getRoomStatusFromMemory(roomName: string): RoomStatusType {
        
        if(Memory.empire.movementData === undefined) {
            Memory.empire.movementData = {};
        }

        if(Memory.empire.movementData[roomName] === undefined) {
            return ROOM_STATUS_UNKNOWN;
        }

        // Dispose of stale movement data
        if(Memory.empire.movementData[roomName].lastSeen < Game.time - MAX_RETAINED_ROOM_STATUS) {
            delete Memory.empire.movementData[roomName].lastSeen;
            return ROOM_STATUS_UNKNOWN;
        }

        return Memory.empire.movementData[roomName].roomStatus;
    }

    private static checkAvoid(roomName: string, allowedRoomStatuses: RoomStatusType[]): boolean {
        const roomStatus = Voyager.getRoomStatusFromMemory(roomName);

        return !_.contains(allowedRoomStatuses, roomStatus);
    }
    /**
     * Draw a circle at a location
     * @param pos RoomPosition
     * @param color color code
     * @param opacity number
     */
    private static circle(pos: RoomPosition, color: string, opacity?: number) {
        new RoomVisual(pos.roomName).circle(pos, {
            radius: 0.45,
            fill: "transparent",
            stroke: color,
            strokeWidth: 0.15,
            opacity
        });
    }

    /**
     * Normalize an object.pos, RoomPosition, or MockRoomPosition to RoomPosition
     */
    private static normalizePos(target: _HasRoomPosition | RoomPosition): RoomPosition {
        return target instanceof RoomPosition ? target : target.pos;
    }

    /**
     * returns a position at a direction relative to origin
     * @param origin
     * @param direction
     * @returns {RoomPosition}
     */
    public static positionAtDirection(origin: RoomPosition, direction: number): RoomPosition | void {
        const offsetX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
        const offsetY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
        const x = origin.x + offsetX[direction];
        const y = origin.y + offsetY[direction];
        if (x > 49 || x < 0 || y > 49 || y < 0) {
            return;
        }
        return new RoomPosition(x, y, origin.roomName);
    }

    /**
     * serialize a path, voyager style. Returns a string of directions.
     * @param startPos
     * @param path
     * @param color
     * @returns {string}
     */
    public static serializePath(startPos: RoomPosition, path: RoomPosition[], color = "orange"): string {
        let serializedPath = "";
        let lastPosition = startPos;
        this.circle(startPos, color);
        for (const position of path) {
            if (position.roomName === lastPosition.roomName) {
                // TODO investigate the cost of using several RoomVisuals vs one
                new RoomVisual(position.roomName).line(position, lastPosition, { color, lineStyle: "dashed" });
                serializedPath += lastPosition.getDirectionTo(position);
            }
            lastPosition = position;
        }
        return serializedPath;
    }

    /**
     * Check if the creep has moved since last tick
     */
    private static isStuck(creep: Creep, state: VoyageState): boolean {
        let stuck = false;
        if (state.lastCoord !== undefined) {
            if (this.isSameCoord(creep.pos, state.lastCoord)) {
                // didn't move
                stuck = true;
            } else if (this.isExit(creep.pos) && this.isExit(state.lastCoord)) {
                // got stuck on exit
                stuck = true;
            }
        }

        return stuck;
    }

    /**
     * Check if two co-ordinates are equal
     */
    private static isSameCoord(pos1: Coord, pos2: Coord): boolean {
        return pos1.x === pos2.x && pos1.y === pos2.y;
    }

    /**
     * Check if two positions are equal
     */
    private static isSamePos(pos1: RoomPosition, pos2: RoomPosition): boolean {
        return this.isSameCoord(pos1, pos2) && pos1.roomName === pos2.roomName;
    }

    /**
     * Check if a coord is an exit
     */
    private static isExit(pos: Coord | RoomPosition): boolean {
        return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
    }
}

// The CPU usage threshold to print a warning message to the console, 1000 ops ~= 1 CPU
const REPORT_CPU_THRESHOLD = 1000;
// The max CPU used by a pathfinding call 1000 ops ~= 1 CPU
const DEFAULT_MAXOPS = 2000;
// The default maximum number of ticks a creep will remain stuck before attempting to repath
const DEFAULT_STUCK_VALUE = 2;
// The maximum number of ticks to consider a room status in movementData valid
const MAX_RETAINED_ROOM_STATUS = 10000;

Creep.prototype.voyageTo = function(destination: RoomPosition | _HasRoomPosition, options?: VoyageToOptions) {
    return Voyager.voyageTo(this, destination, options);
};