import { MemoryApi_Military } from "Utils/Imports/internals";

export class MilitaryCombat_Api {

    /**
     * Check if the squad has passed away
     * @param instance the squad manager we are checking for
     * @returns boolean representing if the squad is dead
     */
    public static isSquadDead(instance: ISquadManager): boolean {
        const creeps: Array<Creep | undefined> = MemoryApi_Military.getCreepsInSquadByInstance(instance);
        for (const i in creeps) {
            const creep: Creep | undefined = creeps[i];
            if (creep) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if the room has been taken or hte operation has been stopped
     * @param instance the squad manager we are checking for
     * TODO, tackle on latter half of the military project when we have a more claer picture of direction for it
     */
    public static isOperationDone(instance: ISquadManager): boolean {
        return false;
    }
}