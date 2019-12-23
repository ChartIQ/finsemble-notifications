import INotificationService from "../../types/Notification-definitions/INotificationService";
import INotification from "../../types/Notification-definitions/INotification";
import IAction from "../../types/Notification-definitions/IAction";
import ISubscription from "../../types/Notification-definitions/ISubscription";
import RouterWrapper, {ROUTER_ENDPOINTS} from "../helpers/RouterWrapper";
import PerformedAction from "../../types/Notification-definitions/PerformedAction";
import {ActionTypes} from "../../types/Notification-definitions/ActionTypes";
import ILastIssued from "../../types/Notification-definitions/ILastIssued";
import ISnoozeTimer from "../../types/Notification-definitions/ISnoozeTimer";
import SnoozeTimer from "../../types/Notification-definitions/SnoozeTimer";
import LastIssued from "../../types/Notification-definitions/LastIssued";

const uuidv4 = require('uuid/v4');

const Finsemble = require("@chartiq/finsemble");

Finsemble.Clients.Logger.start();
Finsemble.Clients.Logger.log("notification Service starting up");

/**
 * A service used to transport notification data across the system
 * TODO: Decide and set what log levels all this should be at.
 * TODO: use immutable js or lowdash.clonedeep to make sure all state changes happen on separate objects.
 */
export default class NotificationService extends Finsemble.baseService implements INotificationService {

	/**
	 * Abstracting all internal state into a single point as a way to keep track of what
	 * needs to change when implementing a solution for storage
	 * TODO: Implement storage - will need to modify all places storageAbstraction is referenced
	 */
	private storageAbstraction: {
		subscriptions: Map<string, ISubscription>,
		snoozeTimers: Map<string, ISnoozeTimer>,

		// TODO: Think about the best representation of notification as oldest ones will need to drop off the list
		// TODO: While also being indexable
		notifications: Map<string, INotification>,
		lastIssued: Map<string, ILastIssued>
	};

	private routerWrapper: RouterWrapper;

	/**
	 * Initializes a new instance of the NotificationService class.
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

		this.storageAbstraction = {
			subscriptions: new Map<string, ISubscription>(),
			snoozeTimers: new Map<string, ISnoozeTimer>(),
			notifications: new Map<string, INotification>(),
			lastIssued: new Map<string, ILastIssued>()
		};

		this.subscribe = this.subscribe.bind(this);
		this.notify = this.notify.bind(this);
		this.broadcastNotifications = this.broadcastNotifications.bind(this);
		this.getLastIssued = this.getLastIssued.bind(this);
		this.readyHandler = this.readyHandler.bind(this);
		this.handleAction = this.handleAction.bind(this);
		this.onBaseServiceReady(this.readyHandler);
	}

	/**
	 *
	 * @param {Function} callback
	 */
	readyHandler(callback: Function) {
		this.routerWrapper = new RouterWrapper(Finsemble.Clients.RouterClient, Finsemble.Clients.Logger);
		this.createRouterEndpoints();
		Finsemble.Clients.Logger.log("notification Service ready");
		callback();
	}

	/**
	 * Setting up the router channels/endpoints
	 */
	createRouterEndpoints() {
		this.setupNotify();
		this.setupLastIssued();
		this.setupSubscribe();
		this.setupAction();
	}

	/**
	 * When incoming notifications arrive, lookup matching subscriptions and call necessary
	 * callbacks on subscription.
	 *
	 * @param {INotification[]} notifications of INotification objects to broadcast.
	 * @private
	 */
	broadcastNotifications(notifications: INotification[]): void {
		this.storageAbstraction.subscriptions.forEach(((subscription, key) => {
			for (let k in notifications) {
				// Check if this notification matches any filters
				if (this.filtersMatch(subscription, notifications[k])) {
					// For each notification that matches, expect a response and send it out.
					this.expectReceipt(subscription, notifications[k]);
					this.routerWrapper.query(
						subscription.channel,
						notifications[k],
						null,
						(error, response) => {
							this.setReceivedReceipt(subscription, notifications[k], error, response);
						}
					);
				}
			}
		}));
	}


	/**
	 * Delete a notification as part of a purge.
	 *
	 * @param {string} id of a notification
	 *
	 * TODO: implement using appropriate storage
	 */
	deleteNotification(id: string): void {
		if (this.storageAbstraction.notifications.has(id)) {
			this.storageAbstraction.notifications.delete(id);
		}
	}

	/**
	 * Handles all messages on the 'action' endpoint/channel and sends them
	 * out to the service that knows how to deal with it.
	 *
	 * @param message
	 */
	handleAction(message): object {
		Finsemble.Clients.Logger.log("Got some actions", message);
		const {notifications, action} = message;
		let response = {
			message: "success",
			errors: []
		};

		notifications.forEach((notification) => {
			try {
				this.delegateAction(notification, action);
			} catch (error) {
				response.message = "fail";
				response.errors.push(error.message);
			}
		});
		return response;
	}

	/**
	 * Creates or updates notifications in Finsemble.
	 *
	 * @param {INotification[]} notifications from external source to be created or updated in Finsemble.
	 */
	notify(notifications: INotification[]): void {
		/**
		 * TODO:
		 * 1. Copy initial incoming state.
		 * 2. Set defaults if needed (receivedAt, issuedAt, Id, initial action history)
		 * 3. Store initial state along with updated state
		 */
		this.storeNotifications(notifications);
		this.broadcastNotifications(notifications);
	}

	/**
	 * Picks up any messages on the 'subscribe' endpoint/channel
	 *
	 * @param {ISubscription} subscription
	 * @return {string} a router channel on which notifications for this subscription will be sent.
	 */
	subscribe(subscription: ISubscription): object {
		const channel = this.getChannel(subscription);
		// TODO: Set the subscriptionId correctly in accordance with the spec
		subscription.id = this.getUuid();
		Finsemble.Clients.Logger.log("Successfully processed subscription: ", subscription);
		Finsemble.Clients.Logger.log("Sending channel and subscription Id");
		subscription.channel = channel;

		this.addToSubscription(subscription);
		return {
			"id": subscription.id,
			"channel": channel
		};
	}

	/**
	 * Stores the time when a notification arrived from a specific source in finsemble.
	 *
	 * @param {string} source a notification that was updated. This notification can then be matched on using a filter to find out when different notifications were last updated.
	 * @param {string} issuedAt ISO8601 format string. When a notification was last delivered to Finsemble.
	 */
	saveLastIssuedAt(source: string, issuedAt: string): void {
		if (!source) {
			return;
		}

		if (this.storageAbstraction.lastIssued.has(source)) {
			const d1 = new Date(issuedAt);
			const d2 = new Date(this.storageAbstraction.lastIssued.get(source).issuedAt);
			// Update only if the new date is newer
			if (d1 > d2) {
				this.storageAbstraction.lastIssued.set(
					source,
					new LastIssued(source, issuedAt)
				);
			}
		} else {
			this.storageAbstraction.lastIssued.set(
				source,
				new LastIssued(source, issuedAt)
			);
		}
	}

	/**
	 * Check if the filters for a subscription match a notification
	 *
	 * @param subscription
	 * @param notification
	 * @return boolean
	 *
	 * TODO: Implement
	 */
	filtersMatch(subscription: ISubscription, notification: INotification): boolean {
		return true;
	}

	/**
	 * Get a channel/endpoint the client will need to listen to
	 *
	 * @param subscription
	 * @return string
	 */
	getChannel(subscription: ISubscription): string {
		return ROUTER_ENDPOINTS.SUBSCRIBE + `.${this.getUuid()}`;
	}

	/**
	 * Snoozes a notification
	 *
	 * @param notification {INotification}
	 * @param action {IAction}
	 *
	 * TODO: notification wake on finsemble restart
	 */
	snooze(notification: INotification, action: IAction): INotification {
		const defaultTimeout = 10000; // TODO: get from config
		const timeout = action.milliseconds ? action.milliseconds : defaultTimeout;

		const snoozeTimer = new SnoozeTimer();
		snoozeTimer.notificationId = notification.id;
		snoozeTimer.snoozeInterval = timeout;
		snoozeTimer.timeoutId = setTimeout(() => {
			notification.isSnoozed = false;
			this.notify([notification]);
		}, timeout);
		this.storageAbstraction.snoozeTimers.set(notification.id, snoozeTimer);
		notification.isSnoozed = true;
		return notification;
	}

	dismiss(notification: INotification, action: IAction): INotification {
		notification.isActionPerformed = true;
		return notification;
	}

	spawn(notification: INotification, action: IAction): INotification {
		notification.isActionPerformed = true;
		// TODO: spawn component using .component and .spawnParams
		return notification;
	}

	/**
	 * Converts an IAction into and IPerformedAction and places it performedActions list
	 *
	 * @param notification
	 * @param action
	 * @return INotification
	 *
	 * @note JavaScript is pass by reference for objects but prefer to be specific by returning a value
	 * not sure if putting a return in is confusing and hinting at it being pass by reference.
	 */
	addPerformedAction(notification: INotification, action: IAction): INotification {
		const performedAction = new PerformedAction();
		performedAction.id = action.id;
		performedAction.type = action.type;
		performedAction.datePerformed = new Date().toISOString();
		notification.actionsHistory.push(performedAction);

		return notification;
	}

	validateForwardParams(action: IAction) {
		if (!action.channel) {
			throw new Error(`No channel set when trying to perform '${action.type}'`);
		}
	}

	/**
	 * Delegate the action to any service that is registered on the correct channel
	 *
	 * @see notificationsBuiltInActionsService for an example
	 *
	 * @param notification
	 * @param action
	 *
	 */
	private delegateAction(notification: INotification, action: IAction): void {
		/**
		 * Action is considered completed by the time it hits the service
		 * ie. (the request for action has been received)
		 * Discussion here https://chartiq.slack.com/archives/CPYQ16K7H/p1574357206003200
		 */
		notification = this.addPerformedAction(notification, action);

		/**
		 * If an action is performed on a notification, it should not be snoozed anymore.
		 */
		this.removeFromSnoozeQueue(notification);

		Finsemble.Clients.Logger.log(`Action type: ${action.type}`);
		notification.isActionPerformed = true;
		// Pick up any updated states from performing the action
		switch (action.type.toUpperCase()) {
			case ActionTypes.SNOOZE:
				notification = this.snooze(notification, action);
				break;
			case ActionTypes.SPAWN:
				notification = this.spawn(notification, action);
				break;
			case ActionTypes.QUERY:
				notification = this.forwardAsQuery(notification, action);
				break;
			case ActionTypes.TRANSMIT:
				notification = this.forwardAsTransmit(notification, action);
				break;
			case ActionTypes.PUBLISH:
				notification = this.forwardAsPublish(notification, action);
				break;
			case ActionTypes.DISMISS:
				notification = this.dismiss(notification, action);
				break;
			default:
				Finsemble.Clients.Logger.error(`Unable to perform action '${action.type}' on notification`);
				return;
		}
		Finsemble.Clients.Logger.log('Updated notification state', notification);

		// Send out the new state to all required clients
		this.notify([notification]);
	}

	/**
	 * Stores the notifications
	 *
	 * @param notifications {INotification[]}
	 */
	private storeNotifications(notifications: INotification[]) {
		notifications.forEach((notification) => {
			// TODO: Store previous state

			if (!notification.id) {
				// Is falsy an appropriate enough check?
				notification.id = this.getUuid(notification);
			}

			if (!notification.issuedAt) {
				notification.issuedAt = new Date().toISOString();
			}

			this.saveLastIssuedAt(notification.source, notification.issuedAt);
			this.storageAbstraction.notifications.set(notification.id, notification)
		});
	}

	/**
	 * Setup callback on notify channel
	 */
	private setupNotify(): void {
		this.routerWrapper.addResponder(ROUTER_ENDPOINTS.NOTIFY, this.notify);
	}


	/**
	 * Setup callback on notify channel
	 */
	private setupLastIssued(): void {
		this.routerWrapper.addResponder(ROUTER_ENDPOINTS.LAST_ISSUED, this.getLastIssued);
	}

	/**
	 * Setup callback on subscribe channel
	 */
	private setupSubscribe() {
		this.routerWrapper.addResponder(ROUTER_ENDPOINTS.SUBSCRIBE, this.subscribe);
	}

	/**
	 * Setup callback on action channel
	 */
	private setupAction() {
		this.routerWrapper.addResponder(ROUTER_ENDPOINTS.HANDLE_ACTION, this.handleAction);
	}

	/**
	 * Sets up that we are expecting a receipt for the subscription and notification.
	 *
	 * @param subscription
	 * @param notification
	 *
	 * TODO: Implement.
	 * TODO: Also implement the mechanism that watches for and retries missing receipts
	 */
	private expectReceipt(subscription: ISubscription, notification: INotification) {
		// We're expecting a received receipt on the channel from the client
	}

	/**
	 * Set the receipt status
	 *
	 * @param subscription
	 * @param notification
	 * @param error The error from the Router query
	 * @param response
	 *
	 * TODO: Implement.
	 * @Note I just put all the params in here... not sure what info will be needed
	 */
	private setReceivedReceipt(subscription: ISubscription, notification: INotification, error: string | null, response) {
		Finsemble.Clients.Logger.log(`Got a receipt on: ${subscription.channel}`);
		// We've received a response from the client. Process it and set the correct value
	}

	/**
	 * Store the subscription so it can be referenced and also unsubscribed from later.
	 *
	 * @param subscription
	 */
	private addToSubscription(subscription) {
		this.storageAbstraction.subscriptions.set(subscription.id, subscription)
	}

	private forwardAsQuery(notification: INotification, action: IAction): INotification {
		this.validateForwardParams(action);
		try {
			notification.isActionPerformed = true;
			this.routerWrapper.query(
				action.channel,
				{
					'notification': notification,
					'actionPayload': action.payload
				},
				''
			);
		} catch (error) {
			Finsemble.Clients.Logger.error(`Error performing action on channel channel: '${action.channel}'`);
			notification.isActionPerformed = false;
		}

		return notification;
	}

	private forwardAsTransmit(notification: INotification, action: IAction): INotification {
		this.validateForwardParams(action);
		this.routerWrapper.transmit(
			action.channel,
			{
				'notification': notification,
				'actionPayload': action.payload
			},
			''
		);

		notification.isActionPerformed = true;
		return notification;
	}

	private forwardAsPublish(notification: INotification, action: IAction): INotification {
		this.validateForwardParams(action);
		this.routerWrapper.publish(
			action.channel,
			{
				'notification': notification,
				'actionPayload': action.payload
			},
			''
		);

		notification.isActionPerformed = true;
		return notification;
	}

	/**
	 * Gets the last issued date for the source provided
	 * If source is not provided it will get the latest issue from the all registered sources
	 *
	 * @param source
	 */
	private getLastIssued(source?: string): string {
		Finsemble.Clients.Logger.log(`Finding last issued for source: '${source}'`);
		let returnValue = '';
		if (source && this.storageAbstraction.lastIssued.has(source)) {
			returnValue = this.storageAbstraction.lastIssued.get(source).issuedAt;
		} else {
			this.storageAbstraction.lastIssued.forEach((lastIssued: ILastIssued) => {
				if (!returnValue) {
					returnValue = lastIssued.issuedAt;
				} else {
					const d1 = new Date(returnValue);
					const d2 = new Date(lastIssued.issuedAt);
					if (d2 > d1) {
						returnValue = lastIssued.issuedAt;
					}
				}
			})
		}

		return returnValue;
	}

	/**
	 * Generates a UUID
	 *
	 * TODO: Ensure correct usage of UUID library - uniqueness. Are there other concerns?
	 */
	private getUuid(notification?: INotification): string {
		return uuidv4();
	}

	private removeFromSnoozeQueue(notification: INotification) {
		if (this.storageAbstraction.snoozeTimers.has(notification.id)) {
			clearTimeout(this.storageAbstraction.snoozeTimers.get(notification.id).timeoutId);
		}
	}
}
