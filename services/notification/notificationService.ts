import INotificationService from "./types/INotificationService";
import INotification from "./types/INotification";
import IAction from "./types/IAction";
import ISubscription from "./types/ISubscription";

const Finsemble = require("@chartiq/finsemble");

import {ROUTER_ENDPOINTS} from "./notificationClient";

Finsemble.Clients.Logger.start();
Finsemble.Clients.Logger.log("notification Service starting up");

class notificationService extends Finsemble.baseService implements INotificationService {
    private representationOfNotifications: any[];

    /**
     * Initializes a new instance of the notificationService class.
     */
    constructor() {
        super({
            // Declare any service or client dependencies that must be available before your service starts up.
            startupDependencies: {
                // If the service is using another service directly via an event listener or a responder, that service
                // should be listed as a service start up dependency.
                services: [],
                // When ever you use a client API with in the service, it should be listed as a client startup
                // dependency. Any clients listed as a dependency must be initialized at the top of this file for your
                // service to startup.
                clients: []
            }
        });

        this.subscriptions = [];

        this.subscribe = this.subscribe.bind(this);
        this.notify = this.notify.bind(this);
        this.broadcastNotifications = this.broadcastNotifications.bind(this);
        this.readyHandler = this.readyHandler.bind(this);
        this.onBaseServiceReady(this.readyHandler);
    }

    /**
     *
     * @param {Function} callback
     */
    readyHandler(callback: Function) {
        this.createRouterEndpoints();
        Finsemble.Clients.Logger.log("notification Service ready");
        callback();
    }

    /**
     * Creates a router endpoint for your service.
     * Add query responders, listeners or pub/sub topic as appropriate.
     */
    createRouterEndpoints() {
        this.setupNotify();
        this.setupSubscribe();
    }

    private setupNotify(): void {
        this.addResponder(ROUTER_ENDPOINTS.PREFIX + ROUTER_ENDPOINTS.NOTIFY, this.notify);
    }

    private setupSubscribe() {
        this.addResponder(ROUTER_ENDPOINTS.PREFIX + ROUTER_ENDPOINTS.SUBSCRIBE, this.subscribe);
    }

    private addResponder(endpoint: string, dataProcessor: Function) {
        Finsemble.Clients.Logger.log(`Adding responder for endpoint: ${endpoint}`);
        Finsemble.Clients.RouterClient.addResponder(endpoint, (err: any, message: any) => {
            Finsemble.Clients.Logger.log(`endpoint called: ${endpoint}`);
            Finsemble.Clients.Logger.log(message);
            if (err) {
                return Finsemble.Clients.Logger.error(`Failed to setup ${endpoint} responder`, err);
            }

            try {
                let returnVal = dataProcessor(message.data);

                message.sendQueryResponse(null, {"status": "success", "data": returnVal});
            } catch (e) {
                message.sendQueryResponse(e);
            }
        });

    }

    private setupBroadcast(): void {
        let endpoint = ROUTER_ENDPOINTS.PREFIX + ROUTER_ENDPOINTS.SUBSCRIBE;
        Finsemble.Clients.RouterClient.addPubSubResponder(endpoint, {"notifications": this.representationOfNotifications});
    }

    subscriptions: any;

    /**
     * @inheritDoc
     */
    broadcastNotifications(notifications: INotification[]): void {
        this.subscriptions.forEach((subscription) => {
            notifications.forEach((notification) => {
                subscription.onNotification(notification);
            });
        })
    }

    /**
     * @inheritDoc
     */
    deleteNotification(id: string): void {
    }

    /**
     * @inheritDoc
     */
    handleAction(notifications: INotification[], action: IAction): void {

    }

    /**
     * @inheritDoc
     */
    notify(notifications: INotification[]): void {
        // Do some things. Store/Modify the notification
        // Call broadcast notifications
        this.representationOfNotifications.push(notifications);

        this.broadcastNotifications(notifications);
    }

    subscribe(subscription: ISubscription): object {
        let channel = this.getChannel(subscription);
        // TODO: Do some checking on the filters
        subscription.id = "subscription_" + Math.random();
        Finsemble.Clients.Logger.log("Got subscription", subscription);
        this.addToSubscription(channel, subscription);
        return {
            "id": subscription.id,
            "channel": channel
        };
    }

    private addToSubscription(channel, subscription) {
        if (this.subscriptions.hasOwnProperty(channel)) {
            this.subscriptions[channel] = [];
        }
        this.subscriptions[channel].push(subscription);
    }

    private getChannel(subscription: ISubscription) {
        return  ROUTER_ENDPOINTS.PREFIX + ROUTER_ENDPOINTS.SUBSCRIBE + ".default";
        // return ROUTER_ENDPOINTS.PREFIX + ROUTER_ENDPOINTS.SUBSCRIBE + ".subscription_" + Math.random();
    }

    /**
     * @inheritDoc
     */
    saveLastUpdatedTime(lastUpdated: Date, notification: INotification): void {
    }
}

const serviceInstance = new notificationService();

serviceInstance.start();

export default serviceInstance;
