export interface IRegister {
    (server:any, options:any, next:any): void;
    attributes?: any;
}

export default
class Chat {
    joi:any;
    boom:any;
    db:any;
    hoek:any;
    realtime:any;

    constructor() {
        this.register.attributes = {
            pkg: require('./../../package.json')
        };

        this.joi = require('joi');
        this.boom = require('boom');
        this.hoek = require('hoek');
    }

    register:IRegister = (server, options, next) => {
        server.bind(this);


        server.dependency(['ark-database', 'ark-realtime'], (server, continueRegister) => {

            this.db = server.plugins['ark-database'];
            this.realtime = server.plugins['ark-realtime'];
            continueRegister();

            this._register(server, options);
            next();
        });
    };

    private _register(server, options) {

        /**
         * get all conversations for currently logged in user
         */
        server.route({
            method: 'GET',
            path: '/my/conversations',
            config: {
                handler: (request, reply) => {
                    var userId = request.auth.credentials._id;
                    this.db.getConversationsByUserId(userId, (err, conversations) => {
                        if (!err) {
                            if (conversations.length) {
                                conversations.forEach((con) => {
                                    if (con.user_1 === userId) {
                                        con.opponent = con.user_2;
                                    } else {
                                        con.opponent = con.user_1;
                                    }
                                    delete con.user_1;
                                    delete con.user_2;
                                });
                            }
                            return reply(conversations);
                        }
                        reply(this.boom.create(400, err));
                    });

                }
            }
        });

        server.route({
            method: 'GET',
            path: '/conversations/{conversationId}',
            config: {
                handler: (request, reply) => {
                    var conversationId = request.params.conversationId;
                    var userId = request.auth.credentials._id;

                    this.db.getConversationById(conversationId, (err, conversation) => {

                        if (!err) {
                            // check if user is participating conversation
                            if (conversation.user_1 === userId || conversation.user_2 === userId) {
                                return reply(conversation);
                            } else {
                                return reply({message: 'you are not a fellow of this conversation'}).code(401);
                            }
                        }
                        reply(this.boom.create(400, err));
                    });

                }
            }
        });

        server.route({
            method: 'GET',
            path: '/messages/{conversationId}',
            config: {
                handler: (request, reply) => {
                    var conversationId = request.params.conversationId;

                    this.db.getMessagesByConversionId(conversationId, (err, messages) => {

                        if (!err) {
                            return reply(messages);
                        }
                        reply(this.boom.create(400, err));
                    });

                },
                description: 'Get all messages of a conversation',
                notes: 'getMessagesByConversionId',
                tags: ['chat', 'messages']
            }
        });

        server.route({
            method: 'POST',
            path: '/messages/{conversationId}',
            config: {
                handler: (request, reply) => {
                    var receiver = request.payload.to;

                    var messageObj = {
                        conversation_id: request.params.conversationId,
                        from: request.payload.from,
                        to: receiver,
                        message: request.payload.message,
                        timestamp: Date.now(),
                        type: 'message'
                    };

                    this.db.saveMessage(messageObj, (err, data) => {
                        if (!err) {
                            this.realtime.emitMessage(receiver, this.hoek.merge(messageObj, {opponent: messageObj.from}));
                            return reply({message: 'message sent'})
                        }
                        return reply(this.boom.create(400, err));
                    });

                },
                validate: {
                    payload: this.joi.object().keys({
                        from: this.joi.string().required(),
                        to: this.joi.string().required(),
                        message: this.joi.string().required()
                    })
                },
                description: 'Create a new message in a conversation',
                notes: 'This will also emit a websocket message to the user',
                tags: ['chat', 'messages', 'websockets']
            }
        });

        var newConversationSchema = this.joi.object().keys({
            user_id: this.joi.string().required(),
            message: this.joi.string().required()
        });

        server.route({
            method: 'POST',
            path: '/conversations',
            config: {
                handler: (request, reply) => {
                    var userId = request.auth.credentials._id;

                    this.db.getExistingConversationByTwoUsers(userId, request.payload.user_id, (err, conversations) => {
                        if (!err) {
                            // if not empty, a conversation already exists
                            if (conversations.length) {
                                return reply(this.boom.conflict('Conversation already exists', conversations[0]));
                            }
                            var conversation = {
                                user_1: userId,
                                user_2: request.payload.user_id,
                                user_1_read: true,
                                user_2_read: false,
                                messages: [{
                                    from: userId,
                                    timestamp: Date.now(),
                                    message: request.payload.message
                                }],
                                type: 'conversation'
                            };

                            this.db.createConversation(conversation, (err, data) => {
                                if (!err) {
                                    return reply(data);
                                }
                                return reply(this.boom.create(400, err));
                            });
                        }
                    });


                },
                description: 'Creates a new conversation with a user',
                notes: 'with_user needs to be a valid from a user',
                tags: ['api', 'chat', 'conversation'],
                validate: {
                    payload: newConversationSchema
                }
            }
        });


    }

    errorInit(error) {
        if (error) {
            console.log('Error: Failed to load plugin (Chat):', error);
        }
    }
}