import { Application, Utils } from '@nativescript/core';
import { colorSchemeProperty, ColorSchemeType, colorStyleProperty, ColorStyleType, Configuration, GoogleSignInButtonBase, IUser } from './common';

export class GoogleError extends Error {
	#native: NSError;
	static fromNative(native: NSError, message?: string) {
		const error = new GoogleError(message || native?.localizedDescription);
		error.#native = native;
		return error;
	}

	get native() {
		return this.#native;
	}
}

export class User implements IUser {
	#native: GIDGoogleUser;
	#grantedScopes: string[];
	static fromNative(user: GIDGoogleUser) {
		if (user instanceof GIDGoogleUser) {
			const usr = new User();
			usr.#native = user;
			return usr;
		}
		return null;
	}

	get id() {
		return this.native.userID;
	}

	get displayName() {
		return this.native?.profile?.name;
	}

	get email() {
		return this.native?.profile?.email;
	}

	get givenName() {
		return this.native?.profile?.givenName;
	}

	get familyName() {
		return this.native?.profile?.familyName;
	}

	get idToken() {
		return this.native?.authentication?.idToken;
	}

	get accessToken() {
		return this.native?.authentication?.accessToken;
	}

	get grantedScopes() {
		if (!this.#grantedScopes) {
			const grantedScopes = [];
			const count = this.native.grantedScopes.count;
			for (let i = 0; i < count; i++) {
				grantedScopes.push(this.native.grantedScopes.objectAtIndex(i));
			}
			this.#grantedScopes = grantedScopes;
		}

		return this.#grantedScopes;
	}

	get photoUrl() {
		if (!this.native?.profile?.hasImage) {
			return null;
		}
		return this.native?.profile?.imageURLWithDimension(120)?.absoluteString;
	}

	get serverAuthCode() {
		return this.native.serverAuthCode;
	}

	requestScopes(scopes: string[]): Promise<User> {
		return new Promise((resolve, reject) => {
			GIDSignIn.sharedInstance.addScopesPresentingViewControllerCallback(scopes, GoogleSignin.topViewController, (user, error) => {
				if (error) {
					reject(GoogleError.fromNative(error));
				} else {
					resolve(User.fromNative(user));
				}
			});
		});
	}

	get native() {
		return this.#native;
	}

	get ios() {
		return this.native;
	}
}

export class GoogleSignin {
	static #nativeConfig: GIDConfiguration;
	static #profileImageSize = 120;
	static configure(configuration: Configuration = {}): Promise<void> {
		return new Promise((resolve, reject) => {
			const pathName = configuration['googleServicePlistPath'] ? configuration['googleServicePlistPath'] : 'GoogleService-Info';

			const path = NSBundle.mainBundle.pathForResourceOfType(pathName, 'plist');

			if (!configuration['clientId'] && !path) {
				const message = 'GoogleSignin: failed to determine clientID - GoogleService-Info.plist was not found and iosClientId was not provided. To fix this error: if you have GoogleService-Info.plist file (usually downloaded from firebase) place it into the project as seen in the iOS guide. Otherwise pass clientId option to configure()';
				reject(GoogleError.fromNative(null, message));
				return;
			}
			let plist: NSDictionary<any, any>;
			let clientId;
			if (configuration['clientId']) {
				clientId = configuration['clientId'];
			} else {
				plist = NSDictionary.alloc().initWithContentsOfFile(path);
				clientId = plist.objectForKey('CLIENT_ID');
			}

			let serverClientId;
			if (configuration['serverClientId']) {
				serverClientId = configuration['serverClientId'];
			} else {
				if (!plist) {
					plist = NSDictionary.alloc().initWithContentsOfFile(path);
				}
				serverClientId = plist.objectForKey('SERVER_CLIENT_ID');
			}

			this.#profileImageSize = Number(configuration['profileImageSize']) ?? 120;

			const config = GIDConfiguration.alloc().initWithClientIDServerClientIDHostedDomainOpenIDRealm(clientId, serverClientId, configuration.hostedDomain || null, configuration['openIDRealm'] || null);
			this.#nativeConfig = config;
			resolve();
		});
	}

	static getCurrentUser(): User | null {
		return User.fromNative(GIDSignIn.sharedInstance?.currentUser);
	}

	static isSignedIn() {
		return GIDSignIn.sharedInstance.hasPreviousSignIn();
	}

	static disconnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			GIDSignIn.sharedInstance.disconnectWithCallback((error) => {
				if (error) {
					reject(GoogleError.fromNative(error));
				} else {
					resolve();
				}
			});
		});
	}

	static signIn() {
		return new Promise((resolve, reject) => {
			GIDSignIn.sharedInstance.signInWithConfigurationPresentingViewControllerCallback(this.#nativeConfig, this.topViewController, (user, error) => {
				if (error) {
					reject(GoogleError.fromNative(error));
				} else {
					resolve(User.fromNative(user));
				}
			});
		});
	}

	static signInSilently(): Promise<User> {
		return new Promise((resolve, reject) => {
			GIDSignIn.sharedInstance.restorePreviousSignInWithCallback((user, error) => {
				if (error) {
					reject(GoogleError.fromNative(error));
				} else {
					resolve(User.fromNative(user));
				}
			});
		});
	}

	static signOut(): Promise<void> {
		return new Promise((resolve, reject) => {
			GIDSignIn.sharedInstance.signOut();
			resolve();
		});
	}

	static getTokens(): Promise<{}> {
		return new Promise((resolve, reject) => {
			const user = GIDSignIn.sharedInstance?.currentUser;
			if (!user) {
				reject(new GoogleError('getTokens requires a user to be signed in'));
				return;
			}

			user.authentication.doWithFreshTokens((auth, error) => {
				if (error) {
					reject(GoogleError.fromNative(error));
				} else {
					resolve({
						idToken: auth?.idToken,
						accessToken: auth?.accessToken,
					});
				}
			});
		});
	}

	static playServicesAvailable() {
		return Promise.resolve(true);
	}

	static get topViewController(): UIViewController | undefined {
		const root = this.rootViewController;
		if (!root) {
			return undefined;
		}
		return this.findTopViewController(root);
	}

	private static get rootViewController(): UIViewController | undefined {
		const keyWindow = UIApplication.sharedApplication.keyWindow;
		return keyWindow ? keyWindow.rootViewController : undefined;
	}

	private static findTopViewController(root: UIViewController): UIViewController | undefined {
		const presented = root.presentedViewController;
		if (presented != null) {
			return this.findTopViewController(presented);
		}
		if (root instanceof UISplitViewController) {
			const last = root.viewControllers.lastObject;
			if (last == null) {
				return root;
			}
			return this.findTopViewController(last);
		} else if (root instanceof UINavigationController) {
			const top = root.topViewController;
			if (top == null) {
				return root;
			}
			return this.findTopViewController(top);
		} else if (root instanceof UITabBarController) {
			const selected = root.selectedViewController;
			if (selected == null) {
				return root;
			}
			return this.findTopViewController(selected);
		} else {
			return root;
		}
	}
}

export class GoogleSignInButton extends GoogleSignInButtonBase {
	createNativeView() {
		return GIDSignInButton.new();
	}

	initNativeView() {
		super.initNativeView();
	}

	[colorSchemeProperty.setNative](value: ColorSchemeType) {
		const nativeView: GIDSignInButton = this.nativeView;
		switch (value) {
			case 'dark':
				nativeView.colorScheme = GIDSignInButtonColorScheme.kGIDSignInButtonColorSchemeDark;
				break;
			case 'light':
				nativeView.colorScheme = GIDSignInButtonColorScheme.kGIDSignInButtonColorSchemeLight;
				break;
			default:
				const mode = Application.systemAppearance();
				switch (mode) {
					case 'dark':
						nativeView.colorScheme = GIDSignInButtonColorScheme.kGIDSignInButtonColorSchemeDark;
						break;
					default:
						nativeView.colorScheme = GIDSignInButtonColorScheme.kGIDSignInButtonColorSchemeLight;
						break;
				}
				break;
		}
	}

	[colorStyleProperty.setNative](value: ColorStyleType) {
		const nativeView: GIDSignInButton = this.nativeView;
		switch (value) {
			case 'wide':
				nativeView.style = GIDSignInButtonStyle.kGIDSignInButtonStyleWide;
				break;
			case 'icon':
				nativeView.style = GIDSignInButtonStyle.kGIDSignInButtonStyleIconOnly;
				break;
			default:
				nativeView.style = GIDSignInButtonStyle.kGIDSignInButtonStyleStandard;
				break;
		}
	}

	public onMeasure(widthMeasureSpec: number, heightMeasureSpec: number) {
		const nativeView = this.nativeView;
		if (nativeView) {
			const width = Utils.layout.getMeasureSpecSize(widthMeasureSpec);
			const height = Utils.layout.getMeasureSpecSize(heightMeasureSpec);
			this.setMeasuredDimension(width, height);
		}
	}
}
