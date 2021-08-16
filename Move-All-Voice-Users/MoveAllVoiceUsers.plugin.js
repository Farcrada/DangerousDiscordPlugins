/**
 * @name MoveAllVoiceUsers
 * @author Farcrada
 * @version 0.9.5
 * @description Moves all users in a particular voice chat.
 * 
 * @website https://github.com/Farcrada/DangerousDiscordPlugins
 * @source https://github.com/Farcrada/DangerousDiscordPlugins/blob/master/Move-All-Voice-Users/MoveAllVoiceUsers.plugin.js
 * @updateUrl https://raw.githubusercontent.com/Farcrada/DangerousDiscordPlugins/master/Move-All-Voice-Users/MoveAllVoiceUsers.plugin.js
 */


const config = {
    info: {
        name: "Move All Voice Users",
        id: "MoveAllVoiceUsers",
        description: "Moves all users in a particular voice chat.",
        version: "0.9.5",
        author: "Farcrada",
        updateUrl: "https://raw.githubusercontent.com/Farcrada/DangerousDiscordPlugins/master/Move-All-Voice-Users/MoveAllVoiceUsers.plugin.js"
    },
    constants: {
        apiAlertCount: 5,
        setChannelDelay: 100,
        delayMultiplication: 5
    }
}


class MoveAllVoiceUsers {
    //I like my spaces
    getName() { return config.info.name; }

    start() {
        if (!global.ZeresPluginLibrary) {
            BdApi.showConfirmationModal("Library Missing", `ZeresPluginLibrary is needed for ${this.getName()} and is missing. Please click Download Now to install it.`, {
                confirmText: "Download Now",
                cancelText: "Cancel",
                onConfirm: () => {
                    require("request").get("https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js",
                        async (error, response, body) => {
                            if (error)
                                return require("electron").shell.openExternal("https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js");
                            await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), body, r));
                        });
                }
            });
        }

        //First try the updater
        try {
            global.ZeresPluginLibrary.PluginUpdater.checkForUpdate(config.info.name, config.info.version, config.info.updateUrl);
        }
        catch (err) {
            console.error(this.getName(), "Plugin Updater could not be reached.", err);
        }

        //Now try to initialize.
        //We use this instead of the constructor() to make sure we only do activity when we are started.
        try {
            this.initialize();
        }
        catch (err) {
            try {
                console.error("Attempting to stop after initialization error...", err)
                this.stop();
            }
            catch (err) {
                console.error(this.getName() + ".stop()", err);
            }
        }
    }

    initialize() {
        //Since this plugin is in a serious greyarea concerning selfbotting,
        //this error will show up everytime the plugin starts.
        BdApi.alert("Selfbotting Warning",
            //Neat thing about `` is that it is very literal.
            //A new line or spaces are represented as is,
            //this removes the need for \r, \n and \t
            `This plugin (${config.info.name}) borders the line of self botting (i.e. banned from Discord). Small amounts of people (< 5) should not pose an issue if not abused.

However, the bigger the amount the bigger the responsibility. A delay has been build in, but that is no guarantee.

You have been warned.`);

        //Guild context menu.
        this.guildUserContextMenus = BdApi.findModule(m => m?.default?.displayName === "GuildChannelUserContextMenu");
        this.guildChannelContextMenus = BdApi.findAllModules(m => m?.default?.displayName === "ChannelListVoiceChannelContextMenu")[0];

        //We only need select functions; spread out over several stores
        this.hasPermission = BdApi.findModuleByProps("getHighestRole").can;
        this.setChannel = BdApi.findModuleByProps("setChannel").setChannel;
        this.getChannel = BdApi.findModuleByProps("getChannel", "getDMFromUserId").getChannel;
        this.getChannels = BdApi.findModuleByProps("getChannels").getChannels;
        this.getGuild = BdApi.findModuleByProps("getGuild").getGuild;
        this.getVoiceChannelId = BdApi.findModuleByProps("getVoiceChannelId").getVoiceChannelId;
        this.getVoiceStatesForChannel = BdApi.findModuleByProps("getVoiceStatesForChannel").getVoiceStatesForChannel;

        //Types
        this.DiscordPermissionsTypes = BdApi.findModuleByProps("Permissions").Permissions;

        //Context menu
        this.ce = BdApi.React.createElement;
        const ContextModule = BdApi.findModuleByProps("MenuGroup", "MenuItem")
        this.MenuItem = ContextModule.MenuItem;
        this.MenuGroup = ContextModule.MenuGroup;

        //Patch the boys
        this.patchGuildUserContext();
        this.patchGuildChannelContext();
    }

    stop() { BdApi.Patcher.unpatchAll(config.info.id); }

    patchGuildChannelContext() {
        BdApi.Patcher.after(config.info.id, this.guildChannelContextMenus, "default", (that, methodArguments, returnValue) => {
            this.moveAllUsers(methodArguments[0].channel, returnValue, true);
        });
    }

    patchGuildUserContext() {
        BdApi.Patcher.after(config.info.id, this.guildUserContextMenus, "default", (that, methodArguments, returnValue) => {
            this.moveAllUsers(this.getChannel(methodArguments[0].channelId), returnValue);
        });
    }

    moveAllUsers(channel, returnValue, channelOrUser) {
        //If there's no channel... ¯\_(ツ)_/¯
        if (!channel)
            return;

        //Get the current channel
        const curChannelData = this.getCurrentChannelData(channel);
        if (!(curChannelData && (curChannelData.count > 1 || curChannelData.managed)))
            return;

        //Check the permissions
        if (!this.canMove(channel, curChannelData))
            return;

        //Is it a channel?
        if (channelOrUser)
            //Since the position of 
            for (let mainChild of returnValue.props.children) {
                if (mainChild.props?.children?.length > 0)
                    for (const child of mainChild.props.children)
                        if (child?.props?.id === "hide-voice-names")
                            mainChild.props.children.push(this.renderElement(channel, curChannelData));
            }
        //Then it's a user
        else
            //                The element    |context sections |items in the section
            returnValue.props.children.props.children[6].props.children.push(this.renderElement(channel, curChannelData));
    }

    canMove(channel, curChannelData) {
        //If not the same channel AND
        if (curChannelData.channel.id !== channel.id &&
            //In the same guild AND
            curChannelData.channel.guild_id === channel.guild_id &&
            //We are an administrator in a server OR
            (this.hasPermission(this.DiscordPermissionsTypes.ADMINISTRATOR, this.getGuild(channel.guild_id)) ||
                //We have the required permissions such as being able to connect to the target channel AND
                (this.hasPermission(this.DiscordPermissionsTypes.CONNECT, channel) &&
                    //We can move members
                    this.hasPermission(this.DiscordPermissionsTypes.MOVE_MEMBERS, channel))))
            //Which means we can move
            return true;
        //Otherwise, obviously not.
        return false;
    }

    getCurrentChannelData(channel) {
        //Get our current channel
        let curChannel = this.getChannel(this.getVoiceChannelId()),
            managed = false;

        //If done without being in a voicechannel
        if (!curChannel) {
            return null;
            curChannel = channel;
            managed = true;
        }

        //Get the member IDs from the current VoiceStates
        const members = Object.keys(this.getVoiceStatesForChannel(curChannel.id));
        if (curChannel && members)
            return { channel: curChannel, members, count: members.length, managed };

        //If nothing; null
        return null;
    }

    move(channel, curChannelData) {
        let delay = config.constants.setChannelDelay;

        if (curChannelData.count > config.constants.apiAlertCount) {
            BdApi.alert("API Alert",
                `Moving this many people increases delay per moved user to avoid API spam.

Keep in mind that abuse (too many people at once) can get you banned for "selfbotting".`);
            delay *= config.constants.delayMultiplication;
        }

        for (const member of curChannelData.members)
            //                                in what guild     who     to where
            setTimeout(() => this.setChannel(channel.guild_id, member, channel.id),
                delay);
    }

    renderElement(channel, curChannelData) {
        if (curChannelData.managed)
            return this.ce(this.MenuGroup, {
                id: "move-all-to",
                label: "Move All To",
                type: "submenu"
            }, this.getVoiceChannels(channel, curChannelData));
        else
            return this.ce(this.MenuItem, {
                id: "move-all",
                label: "Move All",
                action: () => this.move(channel, curChannelData)
            });
    }
}
