import * as migrationImports from '@Lib/migrations';
import { ApplicationEvents, ApplicationStages, SyncEvents } from '@Lib';
import { BaseMigration } from '@Lib/migrations/2020-01-01-base';
import { PureService } from '@Services/pure_service';
import { namespacedKey, RawStorageKeys } from '@Lib/storage_keys';
import { isNullOrUndefined, lastElement } from '@Lib/utils';

/**
 * The migration service orchestrates the execution of multi-stage migrations.
 * Migrations are registered during initial application launch, and listen for application
 * life-cycle events, and act accordingly. For example, a single migration may perform
 * a unique set of steps when the application first launches, and also other steps after the 
 * application is unlocked, or after the first sync completes. Migrations live under /migrations
 * and inherit from the base Migration class.
 */
export class SNMigrationService extends PureService {
  constructor({application, challengeResponder}) {
    super();
    this.application = application;
    this.challengeResponder = challengeResponder;
  }

  /** @access public */
  async initialize() {
    await this.runBaseMigration();
    this.activeMigrations = await this.getRequiredMigrations();
    if(this.activeMigrations.length > 0) {
      const lastMigration = lastElement(this.activeMigrations);
      lastMigration.onDone(async () => {
        await this.saveLastMigrationTimestamp(
          lastMigration.constructor.timestamp()
        );
      });
    }
  }

  /**
  * @access public
  * Application instances will call this function directly when they arrive
  * at a certain migratory state.
  */
  async handleApplicationStage(stage) {
    await super.handleApplicationStage(stage);
    if(stage === ApplicationStages.ReadyForLaunch_05) {
      this.addLoginObserver();
      this.addSyncObserver();
    }
    await this.handleStage(stage);
  }

  async runBaseMigration() {
    const baseMigration = new BaseMigration({
      application: this.application
    });
    await baseMigration.handleStage(
      ApplicationStages.PreparingForLaunch_0
    );
  }

  /** @access private */
  async getRequiredMigrations() {
    const lastMigrationTimestamp = await this.getLastMigrationTimestamp();
    const activeMigrations = [];
    const migrationClasses = Object.keys(migrationImports).map((key) => {
      return migrationImports[key];
    }).sort((a, b) => {
      const aTimestamp = a.timestamp();
      const bTimestamp = b.timestamp();
      if(aTimestamp < bTimestamp) {
        return -1;
      } else if(aTimestamp > bTimestamp) {
        return 1;
      } else {
        return 0;
      }
    });
    for(const migrationClass of migrationClasses) {
      const migrationTimestamp = migrationClass.timestamp();
      if(migrationTimestamp > lastMigrationTimestamp) {
        // eslint-disable-next-line new-cap
        activeMigrations.push(new migrationClass({
          application: this.application,
          challengeResponder: this.challengeResponder
        }));
      }
    }
    return activeMigrations;
  }

  /** @access private */
  getTimeStampKey() {
    return namespacedKey(this.application.namespace, RawStorageKeys.LastMigrationTimestamp);
  }

  /** @access private */
  async getLastMigrationTimestamp() {
    const timestamp = await this.application.deviceInterface.getRawStorageValue(
      this.getTimeStampKey()
    );
    if(isNullOrUndefined(timestamp)) {
      throw 'Timestamp should not be null. Be sure to run base migration first.';
    }
    return JSON.parse(timestamp);
  }

  /** @access private */
  async saveLastMigrationTimestamp(timestamp) {
    await this.application.deviceInterface.setRawStorageValue(
      this.getTimeStampKey(),
      JSON.stringify(timestamp)
    );
  }

  /** @access private */
  addLoginObserver() {
   this.application.addEventObserver(async (event, data) => {
     if(event === ApplicationEvents.SignedIn) {
       await this.handleStage(ApplicationStages.SignedIn_30);
     }
   });
  }

  /** @access private */
  addSyncObserver() {
   this.application.syncService.addEventObserver(async (event, data) => {
     if(event === SyncEvents.FullSyncCompleted) {
       await this.handleStage(ApplicationStages.FullSyncCompleted_13);
     }
   });
  }

  /** @access private */
  async handleStage(stage) {
    for(const migration of this.activeMigrations) {
      await migration.handleStage(stage);
    }
  }
}