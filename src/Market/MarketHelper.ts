import _ from "lodash";
import { UserException, ERROR_WARN } from "Utils/Imports/internals";

export class MarketHelper {
    /**
     * Get the name of the request to use as the property identifier
     * @param request The request to get the name of
     */
    public static getRequestName(request: MarketRequest) {
        return `${request.roomName}_${request.resourceType}`;
    }

    /**
     * Delete a request from memory
     * @param request The request to delete
     */
    public static deleteRequest(request: MarketRequest) {
        delete Memory.empire.market.requests[this.getRequestName(request)];
    }

    /**
     * Delete a request from memory if the market order is complete
     * @param request The request to delete
     */
    public static updateOrderStatus(request: MarketRequest) {
        if (request.status !== "pendingMarket") {
            throw new UserException(
                "MarketRequest Error",
                "Attempted to checkOrderStatus on a request that is not in pendingMarket status - " +
                    +this.getRequestName(request),
                ERROR_WARN
            );
        }

        let orders = _.filter(Game.market.orders, (order: Order) => {
            return order.roomName === request.roomName && order.resourceType === request.resourceType;
        });

        if (orders.length === 0) {
            throw new UserException(
                "MarketRequest Error",
                "Could not find the order for the MarketRequest - " + this.getRequestName(request),
                ERROR_WARN
            );
        }

        let amountLeftInOrder = orders.reduce((total: number, order: Order) => {
            return total + order.amount;
        }, 0);

        if (amountLeftInOrder === 0) {
            request.status = "complete";
            for (let order of orders) {
                Game.market.cancelOrder(order.id);
            }
        }
    }
}
