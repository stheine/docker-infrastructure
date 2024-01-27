----------------
--  Timezone  --
----------------

local tz=require"luatz"


-------------------
--  Environment  --
-------------------

MAILBOX = os.getenv('MAILBOX')


---------------
--  Options  --
---------------

options.keepalive = 5
options.timeout   = 120
options.subscribe = true
options.persist   = true
options.recover   = 'all'
options.reenter   = false
options.wakeonany = true


----------------
--  Accounts  --
----------------

dofile('/config/account.' .. MAILBOX)


--------------
-- Logging --
--------------

io.stdout:setvbuf 'no' -- switch off buffering for stdout

function log(msg)
    time = tz.time_in('Europe/Berlin')
    print(os.date("%Y-%m-%d %H:%M:%S ") .. msg)
end


-------------------
-- Idle with log --
-------------------

function log_enter_idle()
    log('enter_idle()')
    update, event = account.INBOX:enter_idle()
    log('enter_idle() returns ' .. tostring(event))
end


---------------
--  Startup  --
---------------

print('\n\n');
log('-----------------------------------------------------------------');
log('imapfilter startup for ' .. MAILBOX)


---------------
--  Prepare  --
---------------

-- Get the status of a mailbox
log('check_status()')
exist, unread, unseen, uidnext = account.INBOX:check_status()

dofile('/config/prepare.' .. MAILBOX)


---------------
--  Process mailbox  --
---------------

function process_mailbox()
    -- Get the status of a mailbox
    exist, unread, unseen, uidnext = account.INBOX:check_status()
    log('status: ' .. exist .. ' total, ' .. unread .. ' unread, ' .. unseen .. ' unseen')

    -- Get unseen messages with the specified "To" header and a specific "Subject" pattern
    log('check match')

    dofile('/config/filter.' .. MAILBOX)
end


--------------------
--  Process IDLE  --
--------------------

log('start processing')

-- Process the mailbox once on startup
process_mailbox()

while true do
    -- Wait for new message in mailbox
    success, errormsg = recover(log_enter_idle, 10)
    if success then
        log('log_enter_idle() returns')
        process_mailbox()
    else
        log('log_enter_idle() failed')

        sleep(10)
    end
end
