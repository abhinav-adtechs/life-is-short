import AppKit

/// The menu bar: the planner's commands with their shortcuts, and the standard Mac menus around them. ⌘K and ⇧⌘K
/// reach the page first when it has focus (it handles ⌘K itself); the menu catches them everywhere else.
@MainActor
enum MainMenu {
    static func build(for app: AppDelegate) -> NSMenu {
        let bar = NSMenu()
        bar.addItem(menu("Life is short", appMenu(app)))
        bar.addItem(menu("File", [
            item("Dump a Thought", #selector(AppDelegate.dumpThought(_:)), "k", target: app),
            item("Speak", #selector(AppDelegate.speak(_:)), "k", [.command, .shift], target: app),
            .separator(),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
        ]))
        bar.addItem(menu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
            item("Delete", #selector(NSText.delete(_:))),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ]))
        bar.addItem(menu("View", [
            item("Analytics", #selector(AppDelegate.openAnalytics(_:)), "a", [.command, .shift], target: app),
            item("Review", #selector(AppDelegate.openReview(_:)), "r", [.command, .shift], target: app),
            item("Share…", #selector(AppDelegate.openShare(_:)), target: app),
            .separator(),
            item("Reload", #selector(AppDelegate.reloadPlanner(_:)), "r", target: app),
            .separator(),
            item("Actual Size", #selector(AppDelegate.actualSize(_:)), "0", target: app),
            item("Zoom In", #selector(AppDelegate.zoomIn(_:)), "+", target: app),
            item("Zoom Out", #selector(AppDelegate.zoomOut(_:)), "-", target: app),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ]))
        let window = menu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Planner", #selector(AppDelegate.showPlanner(_:)), "1", target: app),
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ])
        bar.addItem(window)
        NSApp.windowsMenu = window.submenu
        let help = menu("Help", [item("Life is short Help", #selector(AppDelegate.openHelp(_:)), "?", target: app)])
        bar.addItem(help)
        NSApp.helpMenu = help.submenu
        return bar
    }

    private static func appMenu(_ app: AppDelegate) -> [NSMenuItem] {
        let services = NSMenu(title: "Services")
        NSApp.servicesMenu = services
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services
        return [
            item("About Life is short", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Settings…", #selector(AppDelegate.openSettings(_:)), ",", target: app),
            item("Change Server…", #selector(AppDelegate.changeServer(_:)), target: app),
            .separator(),
            servicesItem,
            .separator(),
            item("Hide Life is short", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Life is short", #selector(NSApplication.terminate(_:)), "q"),
        ]
    }

    private static func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let submenu = NSMenu(title: title)
        for item in items { submenu.addItem(item) }
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        holder.submenu = submenu
        return holder
    }

    private static func item(_ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        if !key.isEmpty { item.keyEquivalentModifierMask = modifiers }
        item.target = target
        return item
    }
}
