import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import Meta from "common/notifications/definitions/Meta";
import { INotification } from "common/notifications/definitions/INotification";
import IAction from "common/notifications/definitions/IAction";
import IPerformedAction from "common/notifications/definitions/IPerformedAction";

interface NotificationHeaderProps {
	issuedAt?: string;
	receivedAt?: string;
	headerLogo?: string;
	headerText?: string;
}

interface NotificationContentProps {
	title?: string;
	type?: string;
	contentLogo?: string;
	details?: string;
	timeout?: number;
	source?: string;
	meta?: Meta;
	isRead?: boolean;
	isSnoozed?: boolean;
}

interface NotificationActionsProps {
	actions?: IAction[];
	notification: INotification;
	doAction?: Function;
}

interface NotificationPanelProps {
	children?: React.PropsWithChildren<any>;
	notification?: INotification;
	clearActiveNotification?: Function;
	doAction?: Function;
	markUnread: Function;
}

interface NotificationHistoryProps {
	actionsHistory?: IPerformedAction[];
	stateHistory?: INotification[];
}

const HeaderArea = (props: NotificationHeaderProps) => {
	const { useState, useEffect } = React;
	const { headerLogo, headerText } = props;
	const issuedAt = props.issuedAt as string;
	const receivedAt = props.receivedAt as string;

	const [issuedTime, setTime] = useState(
		formatDistanceToNow(new Date(issuedAt), {
			includeSeconds: true
		})
	);

	const [receivedTime, setReceived] = useState(
		formatDistanceToNow(new Date(receivedAt), {
			includeSeconds: true
		})
	);

	useEffect(() => {
		const id = setInterval(() => {
			setTime(
				formatDistanceToNow(new Date(issuedAt), {
					includeSeconds: true
				})
			);
			setReceived(
				formatDistanceToNow(new Date(receivedAt), {
					includeSeconds: true
				})
			);
		}, 10000);
		return () => clearInterval(id);
	});

	return (
		<div className="card_header">
			<div className="notification_logo">
				{headerLogo && <img src={headerLogo} />}
				<div>{headerText}</div>
			</div>
			<br />
			<div className="issued_at">Issued: {issuedTime} ago</div>
			<div className="received_at">Received: {receivedTime} ago</div>
		</div>
	);
};

const ContentArea = (props: NotificationContentProps) => {
	const { title, type, contentLogo, details, timeout, source, isRead, isSnoozed } = props;
	const meta = props.meta as Meta;

	return (
		<div className="details">
			<h4 className="title">{title}</h4>
			<div className="notification_content">
				{contentLogo && <img src={contentLogo} />}
				<div>{details}</div>
			</div>
			<div className="meta-details">
				{(type || source || timeout || Object.keys(meta).length > 0 || isRead || isSnoozed) && (
					<>
						<h5 className="meta-info">Info</h5>
						<ul>
							{type && (
								<li>
									<div className="type">
										Notification Type:&nbsp;&nbsp;<span>{type}</span>
									</div>
								</li>
							)}
							{source && (
								<li>
									<div className="source">
										Notification Source:&nbsp;&nbsp;<span>{source}</span>
									</div>
								</li>
							)}
							{timeout && (
								<li>
									<div className="timeout">
										Notification Timeout:&nbsp;&nbsp;<span>{timeout} ms</span>
									</div>
								</li>
							)}
							{Object.keys(meta).length > 0 && (
								<>
									{Object.keys(meta).map((metaKey, i) => {
										return (
											<li key={i}>
												<span>
													{metaKey} : {meta[metaKey]}
												</span>
											</li>
										);
									})}
								</>
							)}
							{(isRead || isSnoozed) && (
								<li>
									<div className="flags">
										{isRead && (
											<div>
												Viewed: <span>✓</span>
											</div>
										)}
										{isSnoozed && (
											<div>
												Snoozed: <span>✓</span>
											</div>
										)}
									</div>
								</li>
							)}
						</ul>
					</>
				)}
			</div>
		</div>
	);
};

const ActionsArea = (props: NotificationActionsProps) => {
	const { actions, doAction } = props;
	const { ActionTypes } = FSBL.Clients.NotificationClient;
	return (
		<div className="details_footer">
			<hr />
			<div className="actions">
				{actions?.map((action: IAction, i: number) => {
					const isDisabled = action.type === ActionTypes.DISMISS || action.type === ActionTypes.SNOOZE;
					const className = isDisabled ? "disabled" : null;

					return (
						<button
							className={className as string}
							key={i}
							onClick={() => doAction && doAction(props.notification, action)}
							disabled={isDisabled}
						>
							{action.buttonText}
						</button>
					);
				})}
			</div>
		</div>
	);
};

const HistoryArea = (props: NotificationHistoryProps) => {
	const { actionsHistory } = props;

	return (
		<div className="history">
			<hr />
			<div className="history_header">History:</div>
			<ul>
				{actionsHistory?.map((history, i) => {
					if (history.type) {
						return (
							<li key={i}>
								{history.datePerformed} : {history.type}
							</li>
						);
					} else {
						return null;
					}
				})}
			</ul>
		</div>
	);
};

const NotificationsPanel = (props: NotificationPanelProps) => {
	const { notification, doAction, markUnread } = props;
	const { id, actions, isRead } = notification as INotification;

	return (
		<section id="notification-center__notification-detail">
			<h3>
				Notification Detail:{" "}
				<img
					src="../shared/assets/close.svg"
					id="close-icon"
					onClick={() => {
						if (props.clearActiveNotification) {
							props.clearActiveNotification(null);
						}
					}}
				/>
			</h3>
			<div className="notification_card" title={id}>
				<HeaderArea {...notification} />
				<ContentArea {...notification} />
				{notification?.actions && notification.actions.length > 0 && (
					<ActionsArea notification={notification} doAction={doAction} actions={actions} />
				)}
				<HistoryArea {...notification} />
				{isRead && (
					<>
						<hr style={{ width: "100%" }} />
						<button onClick={() => markUnread([notification])}>Mark Unread</button>
					</>
				)}
			</div>
		</section>
	);
};

export default NotificationsPanel;
